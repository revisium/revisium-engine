import { Injectable } from '@nestjs/common';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { sql } from 'src/engine-prisma-types';
import { ChangesBranch } from 'src/features/partial-changes-poc/partial-changes.types';
import {
  ChangesSnapshot,
  RowPair,
  RowVersion,
  TablePair,
  TableVersion,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

type TableLinkRow = TableVersion & { revisionId: string };

type RowPairRow = {
  [K in keyof RowVersion as `h_${K}` | `d_${K}`]: RowVersion[K] | null;
};

type SchemaRow = { id: string; data: JsonSchema };

const ROW_COLUMNS = [
  'versionId',
  'createdId',
  'id',
  'readonly',
  'data',
  'meta',
  'hash',
  'schemaHash',
  'createdAt',
  'updatedAt',
  'publishedAt',
] as const;

@Injectable()
export class SnapshotReader {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly shareQueries: ShareTransactionalQueries,
  ) {}

  private get db() {
    return this.transactionService.getTransaction();
  }

  async read(branch: ChangesBranch): Promise<ChangesSnapshot> {
    const { id: branchId } = await this.shareQueries.findBranchInProjectOrThrow(
      branch.projectId,
      branch.branchName,
    );
    const head =
      await this.shareQueries.findHeadRevisionInBranchOrThrow(branchId);
    const draft =
      await this.shareQueries.findDraftRevisionInBranchOrThrow(branchId);

    const tables = await this.readTablePairs(head.id, draft.id);
    await this.attachSchemas(tables);
    await this.attachChangedRows(tables);

    return {
      branchId,
      projectId: branch.projectId,
      headRevisionId: head.id,
      draftRevisionId: draft.id,
      tables,
    };
  }

  private async readTablePairs(
    headRevisionId: string,
    draftRevisionId: string,
  ): Promise<TablePair[]> {
    const links = await this.db.$queryRaw<TableLinkRow[]>(sql`
      SELECT rt."A" AS "revisionId", t."versionId", t."createdId", t."id",
             t."readonly", t."system", t."createdAt"
      FROM "_RevisionToTable" rt
      JOIN "Table" t ON t."versionId" = rt."B"
      WHERE rt."A" IN (${headRevisionId}, ${draftRevisionId})
    `);

    const pairs = new Map<string, TablePair>();
    for (const { revisionId, ...table } of links) {
      const pair = pairs.get(table.createdId) ?? {
        createdId: table.createdId,
        changedRows: [],
      };
      if (revisionId === headRevisionId) {
        pair.head = table;
      } else {
        pair.draft = table;
      }
      pairs.set(table.createdId, pair);
    }

    return [...pairs.values()];
  }

  private async attachSchemas(tables: TablePair[]): Promise<void> {
    const schemaTable = tables.find(
      (pair) => (pair.head ?? pair.draft)?.id === SystemTables.Schema,
    );
    const headSchemas = await this.readSchemas(schemaTable?.head?.versionId);
    const draftSchemas = await this.readSchemas(schemaTable?.draft?.versionId);

    for (const pair of tables) {
      if (pair.head) {
        pair.headSchema = headSchemas.get(pair.head.id);
      }
      if (pair.draft) {
        pair.draftSchema = draftSchemas.get(pair.draft.id);
      }
    }
  }

  private async readSchemas(
    schemaTableVersionId: string | undefined,
  ): Promise<Map<string, JsonSchema>> {
    if (!schemaTableVersionId) {
      return new Map();
    }

    const rows = await this.db.$queryRaw<SchemaRow[]>(sql`
      SELECT r."id", r."data"
      FROM "_RowToTable" rt
      JOIN "Row" r ON r."versionId" = rt."A"
      WHERE rt."B" = ${schemaTableVersionId}
    `);

    return new Map(rows.map((row) => [row.id, row.data]));
  }

  private async attachChangedRows(tables: TablePair[]): Promise<void> {
    for (const pair of tables) {
      if (
        pair.head &&
        pair.draft &&
        pair.head.versionId !== pair.draft.versionId
      ) {
        pair.changedRows = await this.readChangedRows(
          pair.head.versionId,
          pair.draft.versionId,
        );
      }
    }
  }

  private async readChangedRows(
    headTableVersionId: string,
    draftTableVersionId: string,
  ): Promise<RowPair[]> {
    const rows = await this.db.$queryRaw<RowPairRow[]>(sql`
      WITH h AS (
        SELECT r.* FROM "_RowToTable" rt JOIN "Row" r ON r."versionId" = rt."A"
        WHERE rt."B" = ${headTableVersionId}
      ),
      d AS (
        SELECT r.* FROM "_RowToTable" rt JOIN "Row" r ON r."versionId" = rt."A"
        WHERE rt."B" = ${draftTableVersionId}
      )
      SELECT
        h."versionId" AS "h_versionId", h."createdId" AS "h_createdId", h."id" AS "h_id",
        h."readonly" AS "h_readonly", h."data" AS "h_data", h."meta" AS "h_meta",
        h."hash" AS "h_hash", h."schemaHash" AS "h_schemaHash", h."createdAt" AS "h_createdAt",
        h."updatedAt" AS "h_updatedAt", h."publishedAt" AS "h_publishedAt",
        d."versionId" AS "d_versionId", d."createdId" AS "d_createdId", d."id" AS "d_id",
        d."readonly" AS "d_readonly", d."data" AS "d_data", d."meta" AS "d_meta",
        d."hash" AS "d_hash", d."schemaHash" AS "d_schemaHash", d."createdAt" AS "d_createdAt",
        d."updatedAt" AS "d_updatedAt", d."publishedAt" AS "d_publishedAt"
      FROM h FULL OUTER JOIN d ON h."createdId" = d."createdId"
      WHERE h."versionId" IS DISTINCT FROM d."versionId"
        AND (h."createdId" IS NULL OR d."createdId" IS NULL
             OR h."id" <> d."id" OR h."hash" <> d."hash")
    `);

    return rows.map((row) => {
      const head = this.toRowVersion(row, 'h_');
      const draft = this.toRowVersion(row, 'd_');
      return {
        createdId: (head ?? draft)?.createdId ?? '',
        head,
        draft,
      };
    });
  }

  private toRowVersion(
    row: RowPairRow,
    prefix: 'h_' | 'd_',
  ): RowVersion | undefined {
    const values = row as unknown as Record<string, unknown>;
    if (values[`${prefix}versionId`] === null) {
      return undefined;
    }

    return Object.fromEntries(
      ROW_COLUMNS.map((column) => [column, values[`${prefix}${column}`]]),
    ) as unknown as RowVersion;
  }
}
