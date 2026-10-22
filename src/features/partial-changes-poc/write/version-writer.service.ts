import { Injectable } from '@nestjs/common';
import { sql } from 'src/engine-prisma-types';
import type { InputJsonValue } from 'src/engine-prisma-types';
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

const CREATE_BATCH_SIZE = 1000;

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
      WHERE rt."B" = ${args.copyLinksFrom}
        AND NOT (rt."A" = ANY(${[...args.withoutRowVersionIds]}::text[]))
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
    const now = new Date();

    for (let start = 0; start < rows.length; start += CREATE_BATCH_SIZE) {
      const batch = rows.slice(start, start + CREATE_BATCH_SIZE).map((row) => ({
        versionId: this.idService.generate(),
        createdId: row.createdId,
        id: row.id,
        readonly,
        data: row.data as InputJsonValue,
        meta: row.meta as InputJsonValue,
        hash: row.hash,
        schemaHash: row.schemaHash,
        createdAt: row.createdAt,
        updatedAt: now,
        publishedAt: row.publishedAt,
      }));
      await this.db.row.createMany({ data: batch });
      versionIds.push(...batch.map((row) => row.versionId));
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

  async lockTableWithRows(tableVersionId: string): Promise<void> {
    await this.db.$executeRaw(sql`
      UPDATE "Table" SET "readonly" = true
      WHERE "versionId" = ${tableVersionId} AND "readonly" = false
    `);

    await this.lockRowsOfTable(tableVersionId);
  }

  async lockRowsOfTable(tableVersionId: string): Promise<void> {
    await this.db.$executeRaw(sql`
      UPDATE "Row" SET "readonly" = true
      WHERE "readonly" = false
        AND "versionId" IN (SELECT "A" FROM "_RowToTable" WHERE "B" = ${tableVersionId})
    `);
  }
}
