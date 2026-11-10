import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import { schemaRowOf } from 'src/features/share/ledger/migration-ledger';
import type { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { findTableIdError } from 'src/features/share/utils/validateUrlLikeId/table-id-error';
import type { BackfillRevision } from './backfill-state-reader';

export interface HeadTableSchema {
  readonly tableId: string;
  readonly schema: JsonSchema;
  readonly references: readonly string[];
}

export interface TableFailure {
  readonly tableId: string;
  readonly error: string;
}

export interface HeadTableSchemas {
  readonly tables: readonly HeadTableSchema[];
  readonly failures: readonly TableFailure[];
}

export function headTableSchemasOf(
  head: BackfillRevision,
  rules: NativeSchemaRules,
): HeadTableSchemas {
  const tableIds = head.userTables.map(({ id }) => id).sort(compareCodePoints);
  const headTableIds = new Set(tableIds);
  const tables: HeadTableSchema[] = [];
  const failures: TableFailure[] = [];

  for (const tableId of tableIds) {
    try {
      const schema = validSchemaOf(
        tableId,
        head.schemaRows.get(tableId),
        rules,
      );
      const references = rules
        .foreignKeysOf(schema)
        .filter((target) => target !== tableId && headTableIds.has(target));

      tables.push({ tableId, schema, references });
    } catch (error) {
      failures.push({ tableId, error: messageOf(error) });
    }
  }

  return { tables, failures };
}

function validSchemaOf(
  tableId: string,
  schemaRow: Row | undefined,
  rules: NativeSchemaRules,
): JsonSchema {
  if (!schemaRow) {
    throw new Error('it has no schema row');
  }

  const tableIdError = findTableIdError(tableId);

  if (tableIdError) {
    throw new Error(tableIdError);
  }

  const { schema } = schemaRowOf(schemaRow);
  rules.ensureValidSchema(schema);
  rules.ensureValidFieldNames([schema]);

  return schema;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
