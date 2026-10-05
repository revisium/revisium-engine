import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { CacheModule } from '@nestjs/cache-manager';
import { Test, type TestingModule } from '@nestjs/testing';
import type { JsonValue } from 'src/engine-prisma-types';
import type {
  DraftRevisionState,
  DraftRevisionStateRow,
  DraftRevisionStateTable,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { RecomputeCandidateFormulasResult } from 'src/features/draft-changes/queries/impl/recompute-candidate-formulas.query';
import { RecomputeCandidateFormulasHandler } from 'src/features/draft-changes/queries/handlers/recompute-candidate-formulas.handler';
import { RecomputeCandidateFormulasQuery } from 'src/features/draft-changes/queries/impl/recompute-candidate-formulas.query';
import { FormulaValidationService } from 'src/features/plugin/formula';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { validateCandidateStates } from 'src/features/draft-changes/candidates/candidate-validation';

const fixedDate = new Date('2026-01-01T00:00:00.000Z');

export async function createFormulaCandidateOperation() {
  const module: TestingModule = await Test.createTestingModule({
    imports: [CacheModule.register()],
    providers: [
      JsonSchemaStoreService,
      JsonSchemaValidatorService,
      FormulaValidationService,
    ],
  }).compile();
  const handler = new RecomputeCandidateFormulasHandler(
    module.get(FormulaValidationService),
    module.get(JsonSchemaValidatorService),
  );

  return {
    recompute: (input: {
      head: DraftRevisionState;
      draft: DraftRevisionState;
    }) => handler.execute(new RecomputeCandidateFormulasQuery(input)),
    validateCandidates: (head: DraftRevisionState, draft: DraftRevisionState) =>
      validateCandidateStates(
        head,
        draft,
        module.get(JsonSchemaValidatorService),
        module.get(FormulaValidationService),
      ),
    close: () => module.close(),
    validateMetaSchema: (schema: unknown) =>
      module.get(JsonSchemaValidatorService).validateMetaSchema(schema).result,
    mutateNestedNote: (
      result: RecomputeCandidateFormulasResult,
      role: 'head' | 'draft',
      note: string,
    ) => {
      const row = candidateRowByIdentity(result, role);
      if (
        typeof row.data !== 'object' ||
        row.data === null ||
        !('nested' in row.data) ||
        typeof row.data.nested !== 'object' ||
        row.data.nested === null ||
        !('note' in row.data.nested)
      ) {
        throw new Error('Expected a nested note in candidate data.');
      }
      row.data.nested.note = note;
    },
  };
}

export function formulaField(
  type: 'number' | 'string' | 'boolean',
  expression: string,
  defaultValue: JsonValue,
): Record<string, unknown> {
  return {
    type,
    default: defaultValue,
    readOnly: true,
    'x-formula': { version: 1, expression },
  };
}

export function candidateSchema(
  properties: Record<string, unknown>,
  required = Object.keys(properties),
): JsonSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  } as JsonSchema;
}

export function candidateState(options: {
  schema: JsonSchema;
  data: JsonValue;
  rowCreatedId?: string;
  tableCreatedId?: string;
  tableId?: string;
  withoutDataRow?: boolean;
}): DraftRevisionState {
  const tableCreatedId = options.tableCreatedId ?? 'products-created';
  const tableId = options.tableId ?? 'products';
  const schemaRow = candidateRow({
    id: tableId,
    createdId: `schema-${tableCreatedId}`,
    data: options.schema as JsonValue,
  });
  const schemaTable = candidateTable({
    id: SystemTables.Schema,
    createdId: 'system-schema-created',
    rows: [schemaRow],
    system: true,
  });
  const dataRows = options.withoutDataRow
    ? []
    : [
        candidateRow({
          id: 'product-row',
          createdId: options.rowCreatedId ?? 'product-row-created',
          data: options.data,
        }),
      ];
  const dataTable = candidateTable({
    id: tableId,
    createdId: tableCreatedId,
    rows: dataRows,
  });
  return { tables: [schemaTable, dataTable] };
}

export function requireRecomputed(
  result: RecomputeCandidateFormulasResult,
): Extract<RecomputeCandidateFormulasResult, { status: 'recomputed' }> {
  if (result.status !== 'recomputed') {
    throw new Error('Expected candidate formula calculation.');
  }
  return result;
}

export function candidateData(
  result: RecomputeCandidateFormulasResult,
  role: 'head' | 'draft',
  tableCreatedId = 'products-created',
  rowCreatedId = 'product-row-created',
): JsonValue {
  return candidateRowByIdentity(result, role, tableCreatedId, rowCreatedId)
    .data;
}

export function candidateRowByIdentity(
  result: RecomputeCandidateFormulasResult,
  role: 'head' | 'draft',
  tableCreatedId = 'products-created',
  rowCreatedId = 'product-row-created',
): DraftRevisionStateRow {
  const calculated = requireRecomputed(result);
  return stateRowByIdentity(calculated[role], tableCreatedId, rowCreatedId);
}

export function stateRowByIdentity(
  state: DraftRevisionState,
  tableCreatedId = 'products-created',
  rowCreatedId = 'product-row-created',
): DraftRevisionStateRow {
  const table = state.tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const row = table?.rows.find(({ createdId }) => createdId === rowCreatedId);
  if (!row) {
    throw new Error(`Expected formula row '${rowCreatedId}'.`);
  }
  return row;
}

function candidateTable(options: {
  id: string;
  createdId: string;
  rows: DraftRevisionStateRow[];
  system?: boolean;
}): DraftRevisionStateTable {
  return {
    id: options.id,
    createdId: options.createdId,
    versionId: `version-${options.createdId}`,
    readonly: true,
    createdAt: fixedDate,
    updatedAt: fixedDate,
    system: options.system ?? false,
    rows: options.rows,
  };
}

function candidateRow(options: {
  id: string;
  createdId: string;
  data: JsonValue;
}): DraftRevisionStateRow {
  return {
    id: options.id,
    createdId: options.createdId,
    versionId: `version-${options.createdId}`,
    readonly: true,
    createdAt: fixedDate,
    updatedAt: fixedDate,
    publishedAt: fixedDate,
    data: options.data,
    meta: { label: 'kept' },
    hash: `hash-${options.createdId}`,
    schemaHash: `schema-hash-${options.createdId}`,
    fileBlobs: [],
  };
}
