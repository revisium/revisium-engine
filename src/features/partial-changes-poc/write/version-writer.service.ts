import { Injectable } from '@nestjs/common';
import { sql } from 'src/engine-prisma-types';
import { linksMissingIn } from 'src/features/partial-changes-poc/snapshot/row-links';
import { TableVersion } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { IdService } from 'src/infrastructure/database/id.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface NewRowVersion {
  createdId: string;
  id: string;
  data: unknown;
  meta: unknown;
  hash: string;
  schemaHash: string;
  createdAt: Date;
  publishedAt: Date;
}

const CREATE_BATCH_SIZE = 5000;

@Injectable()
export class VersionWriter {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly idService: IdService,
  ) {}

  private get db() {
    return this.transactionService.getTransaction();
  }

  async createTableVersion(args: {
    source: TableVersion;
    id?: string;
    copyLinksFrom: string;
    withoutRowVersionIds: readonly string[];
    readonly: boolean;
  }): Promise<string> {
    const versionId = this.idService.generate();

    await this.db.table.create({
      data: {
        versionId,
        createdId: args.source.createdId,
        id: args.id ?? args.source.id,
        readonly: args.readonly,
        system: args.source.system,
        createdAt: args.source.createdAt,
      },
    });

    await this.db.$executeRaw(sql`
      INSERT INTO "_RowToTable" ("A", "B")
      SELECT rt."A", ${versionId}
      FROM "_RowToTable" rt
      LEFT JOIN unnest(${[...args.withoutRowVersionIds]}::text[]) AS dropped("A")
        ON dropped."A" = rt."A"
      WHERE rt."B" = ${args.copyLinksFrom} AND dropped."A" IS NULL
    `);

    return versionId;
  }

  async linkRows(
    tableVersionId: string,
    rowVersionIds: readonly string[],
  ): Promise<void> {
    if (rowVersionIds.length === 0) {
      return;
    }

    await this.db.$executeRaw(sql`
      INSERT INTO "_RowToTable" ("A", "B")
      SELECT unnest(${[...rowVersionIds]}::text[]), ${tableVersionId}
    `);
  }

  async unlinkRows(
    tableVersionId: string,
    rowVersionIds: readonly string[],
  ): Promise<void> {
    if (rowVersionIds.length === 0) {
      return;
    }

    await this.db.$executeRaw(sql`
      DELETE FROM "_RowToTable"
      WHERE "B" = ${tableVersionId} AND "A" = ANY(${[...rowVersionIds]}::text[])
    `);
  }

  async createRowVersions(
    rows: readonly NewRowVersion[],
    readonly: boolean,
  ): Promise<string[]> {
    const versionIds: string[] = [];
    const now = new Date().toISOString();

    for (let start = 0; start < rows.length; start += CREATE_BATCH_SIZE) {
      const batch = rows.slice(start, start + CREATE_BATCH_SIZE);
      const batchIds = batch.map(() => this.idService.generate());
      await this.db.$executeRaw(sql`
        INSERT INTO "Row" ("versionId", "createdId", "id", "readonly", "data", "meta", "hash",
                           "schemaHash", "createdAt", "updatedAt", "publishedAt")
        SELECT v."versionId", v."createdId", v."id", ${readonly}, v."data"::jsonb, v."meta"::jsonb,
               v."hash", v."schemaHash", v."createdAt"::timestamp(3), ${now}::timestamp(3),
               v."publishedAt"::timestamp(3)
        FROM unnest(
          ${batchIds}::text[],
          ${batch.map((row) => row.createdId)}::text[],
          ${batch.map((row) => row.id)}::text[],
          ${batch.map((row) => JSON.stringify(row.data))}::text[],
          ${batch.map((row) => JSON.stringify(row.meta ?? {}))}::text[],
          ${batch.map((row) => row.hash)}::text[],
          ${batch.map((row) => row.schemaHash)}::text[],
          ${batch.map((row) => isoOf(row.createdAt))}::text[],
          ${batch.map((row) => isoOf(row.publishedAt))}::text[]
        ) AS v("versionId", "createdId", "id", "data", "meta", "hash", "schemaHash",
               "createdAt", "publishedAt")
      `);
      versionIds.push(...batchIds);
    }

    return versionIds;
  }

  async markRowsReadonly(rowVersionIds: readonly string[]): Promise<void> {
    if (rowVersionIds.length === 0) {
      return;
    }

    await this.db.$executeRaw(sql`
      UPDATE "Row" SET "readonly" = true
      WHERE "versionId" = ANY(${[...rowVersionIds]}::text[]) AND "readonly" = false
    `);
  }

  async lockTableWithRows(
    tableVersionId: string,
    lockedTableVersionId: string | undefined,
  ): Promise<void> {
    await this.db.$executeRaw(sql`
      UPDATE "Table" SET "readonly" = true
      WHERE "versionId" = ${tableVersionId} AND "readonly" = false
    `);

    await this.lockRowsOfTable(tableVersionId, lockedTableVersionId);
  }

  async lockRowsOfTable(
    tableVersionId: string,
    lockedTableVersionId: string | undefined,
  ): Promise<void> {
    const candidates = lockedTableVersionId
      ? linksMissingIn(tableVersionId, lockedTableVersionId)
      : sql`SELECT "A" FROM "_RowToTable" WHERE "B" = ${tableVersionId}`;

    await this.db.$executeRaw(sql`
      UPDATE "Row" SET "readonly" = true
      WHERE "readonly" = false AND "versionId" = ANY(ARRAY(${candidates}))
    `);
  }
}

function isoOf(value: Date | string): string {
  return new Date(value).toISOString();
}
