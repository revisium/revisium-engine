import { Injectable } from '@nestjs/common';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { join, sql, type Sql } from 'src/engine-prisma-types';
import {
  comparesPublishedAt,
  comparesSchemaHash,
} from 'src/features/partial-changes-poc/catalogue/row-columns';
import {
  SchemaLeaf,
  storesValueInData,
} from 'src/features/partial-changes-poc/catalogue/schema-leaves';
import { ChangesBranch } from 'src/features/partial-changes-poc/partial-changes.types';
import type { TableScope } from 'src/features/partial-changes-poc/planning/read-scope.service';
import {
  ChangesSnapshot,
  hasChangedUserRows,
  isSystemPair,
  RowPair,
  RowVersion,
  SideRows,
  SystemRows,
  TablePair,
  TableVersion,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { linksMissingIn } from 'src/features/partial-changes-poc/snapshot/row-links';
import { analyzeTableStructure } from 'src/features/partial-changes-poc/structure/table-structure';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

type TableLinkRow = TableVersion & { revisionId: string };

export interface ReadOptions {
  scope?: TableScope;
  readAll?: boolean;
  maxChangedRows?: number;
}

type RowPairRow = {
  [K in keyof RowVersion as `h_${K}` | `d_${K}`]: RowVersion[K] | null;
};

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
    private readonly jsonSchemaStore: JsonSchemaStoreService,
  ) {}

  private get db() {
    return this.transactionService.getTransaction();
  }

  async read(
    branch: ChangesBranch,
    options: ReadOptions = {},
  ): Promise<ChangesSnapshot> {
    const { id: branchId } = await this.shareQueries.findBranchInProjectOrThrow(
      branch.projectId,
      branch.branchName,
    );
    const head =
      await this.shareQueries.findHeadRevisionInBranchOrThrow(branchId);
    const draft =
      await this.shareQueries.findDraftRevisionInBranchOrThrow(branchId);

    const tables = await this.readTablePairs(head.id, draft.id);
    const system = await this.readSystemRows(tables);
    this.attachSchemas(tables, system.schemas);
    this.attachStructures(tables, system.schemas);
    await this.attachSystemChanges(tables);
    markAffected(tables, options.scope);

    const rowTables = tables.filter(
      (pair) => hasChangedUserRows(pair) && (options.readAll || pair.affected),
    );
    const changedRowCount = await this.countChangedRows(rowTables);
    const oversized =
      options.maxChangedRows !== undefined &&
      changedRowCount > options.maxChangedRows;
    if (!oversized) {
      await this.attachChangedRows(rowTables);
    }

    return {
      branchId,
      projectId: branch.projectId,
      headRevisionId: head.id,
      draftRevisionId: draft.id,
      tables,
      system,
      changedRowCount,
      oversized,
    };
  }

  private async countChangedRows(tables: TablePair[]): Promise<number> {
    let total = 0;
    for (const pair of tables) {
      if (pair.head && pair.draft && hasChangedUserRows(pair)) {
        const [counted] = await this.db.$queryRaw<{ count: number }[]>(
          this.changedPairs(
            pair.head.versionId,
            pair.draft.versionId,
            this.rowDifference(pair),
            sql`count(*)::int AS "count"`,
          ),
        );
        total += counted?.count ?? 0;
      }
    }
    return total;
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
        affected: false,
        rowsRead: false,
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

  private async readSystemRows(tables: TablePair[]): Promise<SystemRows> {
    return {
      schemas: await this.readSideRows(tables, SystemTables.Schema),
      migrations: await this.readSideRows(tables, SystemTables.Migration),
      views: await this.readSideRows(tables, SystemTables.Views),
      shared: await this.readSideRows(tables, SystemTables.SharedSchemas),
    };
  }

  private async readSideRows(
    tables: TablePair[],
    systemTableId: SystemTables,
  ): Promise<SideRows> {
    const head = tables.find(
      (pair) => pair.head?.system && pair.head.id === systemTableId,
    )?.head;
    const draft = tables.find(
      (pair) => pair.draft?.system && pair.draft.id === systemTableId,
    )?.draft;

    return {
      head: head ? await this.readRows(head.versionId) : [],
      draft: draft ? await this.readRows(draft.versionId) : [],
    };
  }

  private readRows(tableVersionId: string): Promise<RowVersion[]> {
    return this.db.$queryRaw<RowVersion[]>(sql`
      SELECT r."versionId", r."createdId", r."id", r."readonly", r."data", r."meta",
             r."hash", r."schemaHash", r."createdAt", r."updatedAt", r."publishedAt"
      FROM "_RowToTable" rt
      JOIN "Row" r ON r."versionId" = rt."A"
      WHERE rt."B" = ${tableVersionId}
    `);
  }

  private attachSchemas(tables: TablePair[], schemas: SideRows): void {
    const headSchemas = new Map(schemas.head.map((row) => [row.id, row]));
    const draftSchemas = new Map(schemas.draft.map((row) => [row.id, row]));

    for (const pair of tables) {
      if (pair.head && !pair.head.system) {
        pair.headSchema = headSchemas.get(pair.head.id)?.data as JsonSchema;
      }
      if (pair.draft && !pair.draft.system) {
        pair.draftSchema = draftSchemas.get(pair.draft.id)?.data as JsonSchema;
      }
    }
  }

  private attachStructures(tables: TablePair[], schemas: SideRows): void {
    const headIdentities = identities(tables, 'head');
    const draftIdentities = identities(tables, 'draft');
    const headHistory = historyById(schemas.head);
    const draftHistory = historyById(schemas.draft);

    for (const pair of tables) {
      if (!pair.head || !pair.draft || pair.head.system) {
        continue;
      }
      if (!pair.headSchema || !pair.draftSchema) {
        continue;
      }
      pair.structure = analyzeTableStructure({
        headSchema: pair.headSchema,
        draftSchema: pair.draftSchema,
        headHistory: headHistory.get(pair.head.id) ?? [],
        draftHistory: draftHistory.get(pair.draft.id) ?? [],
        headIdentities,
        draftIdentities,
        refs: this.jsonSchemaStore.refs,
      });
    }
  }

  async attachChangedRows(tables: TablePair[]): Promise<void> {
    for (const pair of tables) {
      if (pair.head && pair.draft && hasChangedUserRows(pair)) {
        pair.changedRows = await this.readChangedRows(
          pair.head.versionId,
          pair.draft.versionId,
          this.rowDifference(pair),
        );
        pair.rowsRead = true;
      }
    }
  }

  private async attachSystemChanges(tables: TablePair[]): Promise<void> {
    for (const pair of tables.filter(isSystemPair)) {
      if (pair.head && pair.draft) {
        if (pair.head.versionId !== pair.draft.versionId) {
          pair.changedRows = await this.readChangedRows(
            pair.head.versionId,
            pair.draft.versionId,
            this.rowDifference(pair),
          );
        }
      } else {
        pair.changedRows = await this.oneSidedSystemRows(pair);
      }
      pair.rowsRead = true;
    }
  }

  async readRowsDigest(tableVersionId: string): Promise<string> {
    const [digest] = await this.db.$queryRaw<{ digest: string }[]>(sql`
      SELECT count(*)::text || ':' || coalesce(md5(string_agg(
        concat_ws(':', r."versionId", r."id", r."hash", r."schemaHash",
                  (extract(epoch FROM r."publishedAt") * 1000)::bigint::text, r."meta"::text),
        ',' ORDER BY r."versionId")), '-') AS "digest"
      FROM "_RowToTable" rt
      JOIN "Row" r ON r."versionId" = rt."A"
      WHERE rt."B" = ${tableVersionId}
    `);
    return digest?.digest ?? '';
  }

  async contentDiffers(
    tableVersionId: string,
    otherTableVersionId: string,
  ): Promise<boolean> {
    if (tableVersionId === otherTableVersionId) {
      return false;
    }
    const [result] = await this.db.$queryRaw<{ differs: boolean }[]>(sql`
      WITH a_only AS MATERIALIZED (
        ${linksMissingIn(tableVersionId, otherTableVersionId)}
      ),
      b_only AS MATERIALIZED (
        ${linksMissingIn(otherTableVersionId, tableVersionId)}
      ),
      a AS (
        SELECT r.* FROM "Row" r WHERE r."versionId" = ANY(ARRAY(SELECT "A" FROM a_only))
      ),
      b AS (
        SELECT r.* FROM "Row" r WHERE r."versionId" = ANY(ARRAY(SELECT "A" FROM b_only))
      )
      SELECT EXISTS (
        SELECT 1 FROM a FULL OUTER JOIN b ON a."createdId" = b."createdId"
        WHERE a."createdId" IS NULL OR b."createdId" IS NULL
           OR a."id" <> b."id" OR a."hash" <> b."hash" OR a."schemaHash" <> b."schemaHash"
           OR a."publishedAt" IS DISTINCT FROM b."publishedAt"
           OR a."meta" IS DISTINCT FROM b."meta"
      ) AS "differs"
    `);
    return result?.differs ?? true;
  }

  private async oneSidedSystemRows(pair: TablePair): Promise<RowPair[]> {
    if (pair.head && pair.draft) {
      return [];
    }
    const side = pair.head ? 'head' : 'draft';
    const rows = await this.readRows(pair[side]?.versionId ?? '');
    return rows.map((row) => ({ createdId: row.createdId, [side]: row }));
  }

  private rowDifference(pair: TablePair): Sql {
    return join(
      [
        sql`h."id" <> d."id"`,
        this.dataDifference(pair),
        ...this.columnDifferences(pair),
      ],
      ' OR ',
    );
  }

  private columnDifferences(pair: TablePair): Sql[] {
    const differences = [sql`h."meta" IS DISTINCT FROM d."meta"`];
    if (comparesPublishedAt(pair)) {
      differences.push(sql`h."publishedAt" IS DISTINCT FROM d."publishedAt"`);
    }
    if (comparesSchemaHash(pair)) {
      differences.push(sql`h."schemaHash" <> d."schemaHash"`);
    }
    return differences;
  }

  private dataDifference(pair: TablePair): Sql {
    if (!pair.structure?.differs) {
      return sql`h."hash" <> d."hash"`;
    }

    const leaves = pair.structure.unchangedLeaves.filter(storesValueInData);
    if (leaves.length === 0) {
      return sql`FALSE`;
    }

    return join(
      leaves.map((leaf) => leafDiffers(leaf)),
      ' OR ',
    );
  }

  private async readChangedRows(
    headTableVersionId: string,
    draftTableVersionId: string,
    rowDifference: Sql,
  ): Promise<RowPair[]> {
    const rows = await this.db.$queryRaw<RowPairRow[]>(
      this.changedPairs(
        headTableVersionId,
        draftTableVersionId,
        rowDifference,
        sql`
          h."versionId" AS "h_versionId", h."createdId" AS "h_createdId", h."id" AS "h_id",
          h."readonly" AS "h_readonly", h."data" AS "h_data", h."meta" AS "h_meta",
          h."hash" AS "h_hash", h."schemaHash" AS "h_schemaHash", h."createdAt" AS "h_createdAt",
          h."updatedAt" AS "h_updatedAt", h."publishedAt" AS "h_publishedAt",
          d."versionId" AS "d_versionId", d."createdId" AS "d_createdId", d."id" AS "d_id",
          d."readonly" AS "d_readonly", d."data" AS "d_data", d."meta" AS "d_meta",
          d."hash" AS "d_hash", d."schemaHash" AS "d_schemaHash", d."createdAt" AS "d_createdAt",
          d."updatedAt" AS "d_updatedAt", d."publishedAt" AS "d_publishedAt"
        `,
      ),
    );

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

  private changedPairs(
    headTableVersionId: string,
    draftTableVersionId: string,
    rowDifference: Sql,
    columns: Sql,
  ): Sql {
    return sql`
      WITH head_only AS MATERIALIZED (
        ${linksMissingIn(headTableVersionId, draftTableVersionId)}
      ),
      draft_only AS MATERIALIZED (
        ${linksMissingIn(draftTableVersionId, headTableVersionId)}
      ),
      h AS (
        SELECT r.* FROM "Row" r WHERE r."versionId" = ANY(ARRAY(SELECT "A" FROM head_only))
      ),
      d AS (
        SELECT r.* FROM "Row" r WHERE r."versionId" = ANY(ARRAY(SELECT "A" FROM draft_only))
      )
      SELECT ${columns}
      FROM h FULL OUTER JOIN d ON h."createdId" = d."createdId"
      WHERE h."createdId" IS NULL OR d."createdId" IS NULL OR (${rowDifference})
    `;
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

function markAffected(tables: TablePair[], scope: TableScope | undefined) {
  const affected = scope ? scope(tables) : new Set<string>();
  for (const pair of tables) {
    pair.affected =
      isSystemPair(pair) || affected === 'all' || affected.has(pair.createdId);
    pair.rowsRead = pair.rowsRead || !hasChangedUserRows(pair);
  }
}

function leafDiffers(leaf: SchemaLeaf): Sql {
  return sql`(h."data" #> ${leaf.segments}::text[]) IS DISTINCT FROM (d."data" #> ${leaf.segments}::text[])`;
}

function identities(
  tables: TablePair[],
  side: 'head' | 'draft',
): Map<string, string> {
  return new Map(
    tables
      .map((pair) => pair[side])
      .filter((table): table is TableVersion => Boolean(table && !table.system))
      .map((table) => [table.id, table.createdId]),
  );
}

function historyById(rows: RowVersion[]): Map<string, HistoryPatches[]> {
  return new Map(
    rows.map((row) => [row.id, (row.meta ?? []) as HistoryPatches[]]),
  );
}
