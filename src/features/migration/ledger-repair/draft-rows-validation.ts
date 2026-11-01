import { BadRequestException, Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { getForeignKeysFromSchema } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import {
  type InputJsonValue,
  SortOrder,
  type Sql,
  sql,
} from 'src/engine-prisma-types';
import { ValidateDataCommand } from 'src/features/draft/commands/impl/transactional/validate-data.command';
import type {
  ConsultedTableFingerprint,
  InvalidRows,
  ValidatedTableFingerprint,
  ValidationFingerprint,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const ROW_BATCH_SIZE = 500;
const INVALID_ROW_SAMPLE_SIZE = 10;

export interface DraftTable {
  readonly tableId: string;
  readonly versionId: string;
  readonly schema: JsonSchema;
}

interface DraftRow {
  readonly rowId: string;
  readonly data: InputJsonValue;
}

@Injectable()
export class DraftRowsValidation {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly commandBus: CommandBus,
    private readonly schemaStore: JsonSchemaStoreService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  public async findInvalidRows(
    revisionId: string,
    table: DraftTable,
  ): Promise<InvalidRows | undefined> {
    let invalidRows: InvalidRows = { count: 0, sampleRowIds: [] };

    for await (const rows of this.rowBatchesOf(table.versionId)) {
      invalidRows = withInvalidRowIds(
        invalidRows,
        await this.invalidRowIdsOf(revisionId, table, rows),
      );
    }

    if (invalidRows.count === 0) {
      return undefined;
    }

    return invalidRows;
  }

  public async fingerprintOf(
    validatedTables: readonly DraftTable[],
    draftTableVersionIds: ReadonlyMap<string, string>,
  ): Promise<ValidationFingerprint> {
    const consultedVersionIds = validatedTables.flatMap(({ schema }) =>
      this.foreignKeyTargetsOf(schema).flatMap(
        (tableId) => draftTableVersionIds.get(tableId) ?? [],
      ),
    );

    return {
      validatedTables: await this.digestsOf<ValidatedTableFingerprint>(
        validatedTables.map(({ versionId }) => versionId),
        rowVersionsDigestSql,
      ),
      consultedTables: await this.digestsOf<ConsultedTableFingerprint>(
        consultedVersionIds,
        rowIdsDigestSql,
      ),
    };
  }

  private async invalidRowIdsOf(
    revisionId: string,
    table: DraftTable,
    rows: readonly DraftRow[],
  ): Promise<string[]> {
    if (await this.areValid(revisionId, table, rows)) {
      return [];
    }

    const invalidRowIds: string[] = [];

    for (const row of rows) {
      if (!(await this.areValid(revisionId, table, [row]))) {
        invalidRowIds.push(row.rowId);
      }
    }

    return invalidRowIds;
  }

  private async areValid(
    revisionId: string,
    { tableId, schema }: DraftTable,
    rows: readonly DraftRow[],
  ): Promise<boolean> {
    try {
      await this.commandBus.execute(
        new ValidateDataCommand({
          revisionId,
          tableId,
          tableSchema: schema,
          rows: [...rows],
        }),
      );

      return true;
    } catch (error) {
      if (error instanceof BadRequestException) {
        return false;
      }

      throw error;
    }
  }

  private async *rowBatchesOf(
    tableVersionId: string,
  ): AsyncGenerator<DraftRow[]> {
    let rows = await this.readRowsAfter(tableVersionId, '');

    while (rows.length > 0) {
      yield rows;
      rows = await this.readRowsAfter(tableVersionId, lastRowIdOf(rows));
    }
  }

  private async readRowsAfter(
    tableVersionId: string,
    afterRowId: string,
  ): Promise<DraftRow[]> {
    const rows = await this.transaction.row.findMany({
      where: {
        id: { gt: afterRowId },
        tables: { some: { versionId: tableVersionId } },
      },
      orderBy: { id: SortOrder.asc },
      take: ROW_BATCH_SIZE,
      select: { id: true, data: true },
    });

    return rows.map(({ id, data }) => ({
      rowId: id,
      data: data as InputJsonValue,
    }));
  }

  private foreignKeyTargetsOf(schema: JsonSchema): string[] {
    return getForeignKeysFromSchema(this.schemaStore.create(schema));
  }

  private async digestsOf<T>(
    tableVersionIds: readonly string[],
    digestSql: (tableVersionId: string) => Sql,
  ): Promise<T[]> {
    const digests: T[] = [];

    for (const tableVersionId of [...new Set(tableVersionIds)].sort(
      compareCodePoints,
    )) {
      const [digest] = await this.transaction.$queryRaw<T[]>(
        digestSql(tableVersionId),
      );

      if (digest) {
        digests.push(digest);
      }
    }

    return digests;
  }
}

function withInvalidRowIds(
  { count, sampleRowIds }: InvalidRows,
  invalidRowIds: readonly string[],
): InvalidRows {
  return {
    count: count + invalidRowIds.length,
    sampleRowIds: [...sampleRowIds, ...invalidRowIds].slice(
      0,
      INVALID_ROW_SAMPLE_SIZE,
    ),
  };
}

function lastRowIdOf(rows: readonly DraftRow[]): string {
  return rows.at(-1)?.rowId ?? '';
}

function rowVersionsDigestSql(tableVersionId: string): Sql {
  return sql`
    SELECT ${tableVersionId}::text AS "tableVersionId",
           count(*)::int AS "rowCount",
           coalesce(md5(string_agg(
             jsonb_build_array(r."versionId", r."hash")::text, ','
             ORDER BY r."id" COLLATE "C"
           )), '') AS "digest"
    FROM "_RowToTable" rt
    JOIN "Row" r ON r."versionId" = rt."A"
    WHERE rt."B" = ${tableVersionId}
  `;
}

function rowIdsDigestSql(tableVersionId: string): Sql {
  return sql`
    SELECT ${tableVersionId}::text AS "tableVersionId",
           coalesce(md5(string_agg(
             to_jsonb(r."id")::text, ',' ORDER BY r."id" COLLATE "C"
           )), '') AS "digest"
    FROM "_RowToTable" rt
    JOIN "Row" r ON r."versionId" = rt."A"
    WHERE rt."B" = ${tableVersionId}
  `;
}
