import { Injectable } from '@nestjs/common';
import { sql } from 'src/engine-prisma-types';
import type {
  NewRowVersion,
  RowLinkChanges,
} from 'src/features/draft-revision/commands/impl/target-write-plan';
import { IdService } from 'src/infrastructure/database/id.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const NEW_ROWS_BATCH_SIZE = 5_000;

export interface AssembledTableVersion {
  readonly versionId: string;
  readonly newRowVersionIds: readonly string[];
}

@Injectable()
export class AssembledVersionWriter {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly idService: IdService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  public async createTableVersion(
    sourceVersionId: string,
    changes: RowLinkChanges,
  ): Promise<AssembledTableVersion> {
    const versionId = this.idService.generate();

    await this.copyTableVersion(sourceVersionId, versionId);
    await this.copyRowLinks(sourceVersionId, versionId, changes);

    return {
      versionId,
      newRowVersionIds: await this.insertRowVersions(
        versionId,
        changes.newRows,
      ),
    };
  }

  public async editTableVersion(
    versionId: string,
    changes: RowLinkChanges,
  ): Promise<AssembledTableVersion> {
    await this.unlinkRows(versionId, changes.removedRowVersionIds);
    await this.linkRows(versionId, changes.addedRowVersionIds);

    return {
      versionId,
      newRowVersionIds: await this.insertRowVersions(
        versionId,
        changes.newRows,
      ),
    };
  }

  private async copyTableVersion(
    sourceVersionId: string,
    versionId: string,
  ): Promise<void> {
    const created = await this.transaction.$executeRaw(sql`
      INSERT INTO "Table" ("versionId", "createdId", "id", "readonly", "system", "createdAt")
      SELECT ${versionId}, "createdId", "id", false, "system", "createdAt"
      FROM "Table"
      WHERE "versionId" = ${sourceVersionId}
    `);

    if (created === 0) {
      throw new Error(`Table version ${sourceVersionId} does not exist`);
    }
  }

  private async copyRowLinks(
    sourceVersionId: string,
    versionId: string,
    { removedRowVersionIds, addedRowVersionIds }: RowLinkChanges,
  ): Promise<void> {
    await this.transaction.$executeRaw(sql`
      INSERT INTO "_RowToTable" ("A", "B")
      SELECT base."A", ${versionId}
      FROM "_RowToTable" base
      WHERE base."B" = ${sourceVersionId}
        AND NOT EXISTS (
          SELECT 1 FROM unnest(${[...removedRowVersionIds]}::text[]) AS removed("A")
          WHERE removed."A" = base."A"
        )
      UNION ALL
      SELECT added."A", ${versionId}
      FROM unnest(${[...addedRowVersionIds]}::text[]) AS added("A")
    `);
  }

  private async unlinkRows(
    versionId: string,
    rowVersionIds: readonly string[],
  ): Promise<void> {
    if (rowVersionIds.length === 0) {
      return;
    }

    await this.transaction.$executeRaw(sql`
      DELETE FROM "_RowToTable" link
      USING unnest(${[...rowVersionIds]}::text[]) AS removed("A")
      WHERE link."B" = ${versionId} AND link."A" = removed."A"
    `);
  }

  private async linkRows(
    versionId: string,
    rowVersionIds: readonly string[],
  ): Promise<void> {
    if (rowVersionIds.length === 0) {
      return;
    }

    await this.transaction.$executeRaw(sql`
      INSERT INTO "_RowToTable" ("A", "B")
      SELECT added."A", ${versionId}
      FROM unnest(${[...rowVersionIds]}::text[]) AS added("A")
    `);
  }

  private async insertRowVersions(
    tableVersionId: string,
    rows: readonly NewRowVersion[],
  ): Promise<string[]> {
    const versionIds: string[] = [];

    for (let start = 0; start < rows.length; start += NEW_ROWS_BATCH_SIZE) {
      const batch = rows.slice(start, start + NEW_ROWS_BATCH_SIZE);

      versionIds.push(...(await this.insertRowBatch(tableVersionId, batch)));
    }

    return versionIds;
  }

  private async insertRowBatch(
    tableVersionId: string,
    rows: readonly NewRowVersion[],
  ): Promise<string[]> {
    const versionIds = rows.map(() => this.idService.generate());

    await this.transaction.$executeRaw(sql`
      WITH inserted AS (
        INSERT INTO "Row" ("versionId", "createdId", "id", "readonly", "data", "meta",
                           "hash", "schemaHash", "createdAt", "publishedAt")
        SELECT v."versionId", v."createdId", v."id", false, v."data"::jsonb, v."meta"::jsonb,
               v."hash", v."schemaHash", v."createdAt"::timestamp(3), v."publishedAt"::timestamp(3)
        FROM unnest(
          ${versionIds}::text[],
          ${rows.map((row) => row.createdId)}::text[],
          ${rows.map((row) => row.id)}::text[],
          ${rows.map((row) => JSON.stringify(row.data))}::text[],
          ${rows.map((row) => JSON.stringify(row.meta))}::text[],
          ${rows.map((row) => row.hash)}::text[],
          ${rows.map((row) => row.schemaHash)}::text[],
          ${rows.map((row) => row.createdAt.toISOString())}::text[],
          ${rows.map((row) => row.publishedAt.toISOString())}::text[]
        ) AS v("versionId", "createdId", "id", "data", "meta", "hash", "schemaHash",
               "createdAt", "publishedAt")
        RETURNING "versionId"
      )
      INSERT INTO "_RowToTable" ("A", "B")
      SELECT inserted."versionId", ${tableVersionId}
      FROM inserted
    `);

    return versionIds;
  }
}
