import { Injectable } from '@nestjs/common';
import { sql } from 'src/engine-prisma-types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface ReferrerRow {
  id: string;
  createdId: string;
  value: string;
}

export interface ReferencedValue {
  value: string;
  rowId: string;
}

@Injectable()
export class RowLookup {
  constructor(private readonly transactionService: TransactionPrismaService) {}

  private get db() {
    return this.transactionService.getTransaction();
  }

  async findExistingIds(
    tableVersionId: string,
    ids: readonly string[],
  ): Promise<Set<string>> {
    if (ids.length === 0) {
      return new Set();
    }

    const rows = await this.db.$queryRaw<{ id: string }[]>(sql`
      SELECT r."id"
      FROM "_RowToTable" rt
      JOIN "Row" r ON r."versionId" = rt."A"
      WHERE rt."B" = ${tableVersionId} AND r."id" = ANY(${[...ids]}::text[])
    `);

    return new Set(rows.map((row) => row.id));
  }

  async findReferrers(
    tableVersionId: string,
    jsonPath: string,
    ids: readonly string[],
  ): Promise<ReferrerRow[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.db.$queryRaw<ReferrerRow[]>(sql`
      SELECT r."id", r."createdId", v.value #>> '{}' AS "value"
      FROM "_RowToTable" rt
      JOIN "Row" r ON r."versionId" = rt."A"
      CROSS JOIN LATERAL jsonb_path_query(r."data", ${jsonPath}::jsonpath) AS v(value)
      WHERE rt."B" = ${tableVersionId}
        AND jsonb_typeof(v.value) = 'string'
        AND (v.value #>> '{}') = ANY(${[...ids]}::text[])
    `);
  }

  async referencedValues(
    tableVersionId: string,
    jsonPath: string,
    excludeCreatedIds: readonly string[],
  ): Promise<ReferencedValue[]> {
    return this.db.$queryRaw<ReferencedValue[]>(sql`
      SELECT v.value #>> '{}' AS "value", MIN(r."id") AS "rowId"
      FROM "_RowToTable" rt
      JOIN "Row" r ON r."versionId" = rt."A"
      CROSS JOIN LATERAL jsonb_path_query(r."data", ${jsonPath}::jsonpath) AS v(value)
      WHERE rt."B" = ${tableVersionId}
        AND jsonb_typeof(v.value) = 'string'
        AND NOT (r."createdId" = ANY(${[...excludeCreatedIds]}::text[]))
      GROUP BY v.value #>> '{}'
    `);
  }
}
