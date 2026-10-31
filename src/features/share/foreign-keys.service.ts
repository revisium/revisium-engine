import { Injectable } from '@nestjs/common';
import { sql, join, empty, type Sql, type Row } from 'src/engine-prisma-types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

type CountResult = { count: string | number | bigint };

const MAX_INPUT_LENGTH = 1000;
const DEFAULT_QUERY_LIMIT = 100;
const ITERATION_PAGE_SIZE = 100;

// Using parameterized queries with $queryRaw for security
// https://www.prisma.io/docs/orm/prisma-client/queries/raw-database-access/raw-queries#dynamic-table-names-in-postgresql

@Injectable()
export class ForeignKeysService {
  constructor(private readonly transactionService: TransactionPrismaService) {}

  private get transaction() {
    return this.transactionService.getTransactionOrPrisma();
  }

  /**
   * Validates JSON object keys - accepts any valid string
   * Only rejects strings that could break PostgreSQL queries
   */
  private validateJsonKey(input: string, label = 'key'): void {
    // Only reject strings with null bytes or other characters that could break PostgreSQL
    if (input.includes('\0')) {
      throw new Error(`Invalid ${label}: contains null byte`);
    }

    // Reject double quotes and backslashes to prevent jsonpath injection in quoted key segments
    if (input.includes('"') || input.includes('\\')) {
      throw new Error(
        `Invalid ${label}: contains characters that could break jsonpath`,
      );
    }

    // Length check for practical reasons
    if (input.length > MAX_INPUT_LENGTH) {
      throw new Error(
        `Invalid ${label}: too long (max ${MAX_INPUT_LENGTH} characters)`,
      );
    }
  }

  /**
   * Validates JSON path format - very permissive, only essential safety checks
   */
  private validateJsonPath(path: string): void {
    // Basic JSON path validation - must start with $
    if (!path.startsWith('$')) {
      throw new Error(`Invalid JSON path: must start with $ - got: ${path}`);
    }

    // Only reject paths with null bytes that could break PostgreSQL
    if (path.includes('\0')) {
      throw new Error('Invalid JSON path: contains null byte');
    }
  }

  async findRowsByKeyValueInData(
    tableVersionId: string,
    key: string,
    value: string,
    limit: number = DEFAULT_QUERY_LIMIT,
    offset: number = 0,
  ) {
    // Validate key for safety
    this.validateJsonKey(key, 'key');

    return this.transaction.$queryRaw<Row[]>`
      SELECT *
      FROM "Row"
      WHERE "versionId" IN (
        SELECT "A"
        FROM "_RowToTable"
        WHERE "B" = ${tableVersionId}
      )
      AND ${this.keyValueCondition(key, value)}
      ORDER BY "id" ASC
      LIMIT ${limit}
      OFFSET ${offset};
    `;
  }

  async *iterateRowsByKeyValueInData(
    tableVersionId: string,
    key: string,
    value: string,
  ): AsyncGenerator<Row> {
    this.validateJsonKey(key, 'key');

    yield* this.iterateMatchingRows(
      tableVersionId,
      this.keyValueCondition(key, value),
    );
  }

  async countRowsByKeyValueInData(
    tableVersionId: string,
    key: string,
    value: string,
  ) {
    // Validate key for safety
    this.validateJsonKey(key, 'key');

    const result: CountResult[] = await this.transaction.$queryRaw`
        SELECT count(*)
        FROM "Row"
        WHERE "versionId" IN (
          SELECT "A"
          FROM "_RowToTable"
          WHERE "B" = ${tableVersionId}
        )
        AND ${this.keyValueCondition(key, value)};
      `;

    return Number((result[0] as { count: unknown }).count);
  }

  async findRowsByPathsAndValueInData(
    tableVersionId: string,
    jsonPaths: string[],
    value: string,
    limit: number = DEFAULT_QUERY_LIMIT,
    offset: number = 0,
  ) {
    if (jsonPaths.length === 0) {
      return [];
    }

    jsonPaths.forEach((path) => this.validateJsonPath(path));

    return this.transaction.$queryRaw<Row[]>`
      SELECT *
      FROM "Row"
      WHERE "versionId" IN (
        SELECT "A" FROM "_RowToTable" WHERE "B" = ${tableVersionId}
      )
      AND (${this.pathsValueCondition(jsonPaths, value)})
      ORDER BY "id" ASC
      LIMIT ${limit}
      OFFSET ${offset};
    `;
  }

  async *iterateRowsByPathsAndValueInData(
    tableVersionId: string,
    jsonPaths: string[],
    value: string,
  ): AsyncGenerator<Row> {
    if (jsonPaths.length === 0) {
      return;
    }

    jsonPaths.forEach((path) => this.validateJsonPath(path));

    yield* this.iterateMatchingRows(
      tableVersionId,
      this.pathsValueCondition(jsonPaths, value),
    );
  }

  async countRowsByPathsAndValueInData(
    tableVersionId: string,
    jsonPaths: string[],
    value: string,
  ) {
    if (jsonPaths.length === 0) {
      return 0;
    }

    jsonPaths.forEach((path) => this.validateJsonPath(path));

    const result: CountResult[] = await this.transaction.$queryRaw`
        SELECT count(*)
        FROM "Row"
        WHERE "versionId" IN (
          SELECT "A" FROM "_RowToTable" WHERE "B" = ${tableVersionId}
        )
        AND (${this.pathsValueCondition(jsonPaths, value)});
      `;

    return Number((result[0] as { count: unknown }).count);
  }

  /**
   * Batch version: counts rows where any of the paths contains any of the values.
   * More efficient than calling countRowsByPathsAndValueInData in a loop.
   */
  async countRowsByPathsAndValuesInData(
    tableVersionId: string,
    jsonPaths: string[],
    values: string[],
    excludeRowIds: string[] = [],
  ) {
    if (jsonPaths.length === 0 || values.length === 0) {
      return 0;
    }

    jsonPaths.forEach((path) => this.validateJsonPath(path));

    const result: CountResult[] = await this.transaction.$queryRaw`
        WITH "searched" AS MATERIALIZED (
          SELECT jsonb_build_object('values', to_jsonb(${values}::text[])) AS "vars"
        )
        SELECT count(*)
        FROM "Row"
        CROSS JOIN "searched"
        WHERE "versionId" IN (
          SELECT "A" FROM "_RowToTable" WHERE "B" = ${tableVersionId}
        )
        AND (${this.pathsValuesCondition(jsonPaths)})
        AND "id" <> ALL(${excludeRowIds}::text[]);
      `;

    return Number((result[0] as { count: unknown }).count);
  }

  private async *iterateMatchingRows(
    tableVersionId: string,
    condition: Sql,
  ): AsyncGenerator<Row> {
    let afterRowId: string | undefined;
    let page: Row[];

    do {
      page = await this.findPageOfMatchingRows(
        tableVersionId,
        condition,
        afterRowId,
      );
      yield* page;
      afterRowId = page.at(-1)?.id;
    } while (page.length === ITERATION_PAGE_SIZE);
  }

  private findPageOfMatchingRows(
    tableVersionId: string,
    condition: Sql,
    afterRowId: string | undefined,
  ) {
    return this.transaction.$queryRaw<Row[]>`
      SELECT *
      FROM "Row"
      WHERE "versionId" IN (
        SELECT "A" FROM "_RowToTable" WHERE "B" = ${tableVersionId}
      )
      AND (${condition})
      ${this.rowIdAfterCondition(afterRowId)}
      ORDER BY "id" ASC
      LIMIT ${ITERATION_PAGE_SIZE};
    `;
  }

  private rowIdAfterCondition(afterRowId: string | undefined): Sql {
    if (afterRowId === undefined) {
      return empty;
    }

    return sql`AND "id" > ${afterRowId}`;
  }

  private keyValueCondition(key: string, value: string): Sql {
    return sql`
      jsonb_path_exists(
        "data",
        ${`$.**."${key}" ? (@ == $val)`}::jsonpath,
        jsonb_build_object('val', to_jsonb(${value}::text))
      )
    `;
  }

  private pathsValueCondition(jsonPaths: string[], value: string): Sql {
    return join(
      jsonPaths.map(
        (path) => sql`
          jsonb_path_exists(
            "data",
            ${`${path} ? (@ == $val)`}::jsonpath,
            jsonb_build_object('val', to_jsonb(${value}::text))
          )
        `,
      ),
      ' OR ',
    );
  }

  // Lax mode unwraps the $values array, so `@ == $values` holds when @ equals any of them.
  private pathsValuesCondition(jsonPaths: string[]): Sql {
    return join(
      jsonPaths.map(
        (path) => sql`
          jsonb_path_exists(
            "data",
            ${`${path} ? (@ == $values)`}::jsonpath,
            "searched"."vars"
          )
        `,
      ),
      ' OR ',
    );
  }
}
