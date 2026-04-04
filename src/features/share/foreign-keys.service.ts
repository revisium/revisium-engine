import { Injectable } from '@nestjs/common';
import { sql, join, type Sql, type Row } from 'src/engine-prisma-types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

type CountResult = { count: string | number | bigint };

const MAX_INPUT_LENGTH = 1000;
const DEFAULT_QUERY_LIMIT = 100;
const MAX_CONDITIONS = 1000;

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

    // Build the JSON path with quoted key for safety and parameterized value
    const path = `$.**."${key}" ? (@ == $val)`;

    return this.transaction.$queryRaw<Row[]>`
      SELECT *
      FROM "Row"
      WHERE "versionId" IN (
        SELECT "A"
        FROM "_RowToTable"
        WHERE "B" = ${tableVersionId}
      )
      AND jsonb_path_exists(
        "data",
        ${path}::jsonpath,
        jsonb_build_object('val', to_jsonb(${value}::text))
      )
      ORDER BY "id" ASC
      LIMIT ${limit}
      OFFSET ${offset};
    `;
  }

  async countRowsByKeyValueInData(
    tableVersionId: string,
    key: string,
    value: string,
  ) {
    // Validate key for safety
    this.validateJsonKey(key, 'key');

    // Build the JSON path with quoted key for safety and parameterized value
    const path = `$.**."${key}" ? (@ == $val)`;

    const result: CountResult[] = await this.transaction.$queryRaw`
        SELECT count(*)
        FROM "Row"
        WHERE "versionId" IN (
          SELECT "A"
          FROM "_RowToTable"
          WHERE "B" = ${tableVersionId}
        )
        AND jsonb_path_exists(
          "data",
          ${path}::jsonpath,
          jsonb_build_object('val', to_jsonb(${value}::text))
        );
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

    const conditions = join(
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

    return this.transaction.$queryRaw<Row[]>`
      SELECT *
      FROM "Row"
      WHERE "versionId" IN (
        SELECT "A" FROM "_RowToTable" WHERE "B" = ${tableVersionId}
      )
      AND (${conditions})
      ORDER BY "id" ASC
      LIMIT ${limit}
      OFFSET ${offset};
    `;
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

    const conditions = join(
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

    const result: CountResult[] = await this.transaction.$queryRaw`
        SELECT count(*)
        FROM "Row"
        WHERE "versionId" IN (
          SELECT "A" FROM "_RowToTable" WHERE "B" = ${tableVersionId}
        )
        AND (${conditions});
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
  ) {
    if (jsonPaths.length === 0 || values.length === 0) {
      return 0;
    }

    const conditionCount = jsonPaths.length * values.length;
    if (conditionCount > MAX_CONDITIONS) {
      throw new Error(
        `Too many conditions: ${conditionCount} exceeds maximum of ${MAX_CONDITIONS}`,
      );
    }

    jsonPaths.forEach((path) => this.validateJsonPath(path));

    const allConditions: Sql[] = [];

    for (const path of jsonPaths) {
      for (const value of values) {
        allConditions.push(
          sql`
            jsonb_path_exists(
              "data",
              ${`${path} ? (@ == $val)`}::jsonpath,
              jsonb_build_object('val', to_jsonb(${value}::text))
            )
          `,
        );
      }
    }

    const conditions = join(allConditions, ' OR ');

    const result: CountResult[] = await this.transaction.$queryRaw`
        SELECT count(*)
        FROM "Row"
        WHERE "versionId" IN (
          SELECT "A" FROM "_RowToTable" WHERE "B" = ${tableVersionId}
        )
        AND (${conditions});
      `;

    return Number((result[0] as { count: unknown }).count);
  }
}
