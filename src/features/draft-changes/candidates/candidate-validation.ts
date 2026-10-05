import objectHash from 'object-hash';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { CandidateBlocker } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import type { FormulaValidationService } from 'src/features/plugin/formula';
import { calculateFormulaData } from 'src/features/plugin/formula/formula-calculation';

export async function validateCandidateStates(
  head: DraftRevisionState,
  draft: DraftRevisionState,
  validator: JsonSchemaValidatorService,
  formulaValidation: FormulaValidationService,
): Promise<CandidateBlocker[]> {
  const blockers = await validateRole(
    'head',
    head,
    validator,
    formulaValidation,
  );
  blockers.push(
    ...(await validateRole('draft', draft, validator, formulaValidation)),
  );
  return blockers;
}

async function validateRole(
  role: 'head' | 'draft',
  state: DraftRevisionState,
  validator: JsonSchemaValidatorService,
  formulaValidation: FormulaValidationService,
): Promise<CandidateBlocker[]> {
  const blockers: CandidateBlocker[] = [];
  const tableIds = new Set<string>();
  const tableCreatedIds = new Set<string>();
  for (const table of state.tables) {
    const normalizedId = table.id.toLowerCase();
    if (tableIds.has(normalizedId) || tableCreatedIds.has(table.createdId)) {
      blockers.push({
        code: 'IDENTITY_CONFLICT',
        role,
        tableCreatedId: table.createdId,
        identityScope: 'tableId',
        identityId: table.id,
        message: `Duplicate table identity '${table.id}'.`,
      });
    }
    tableIds.add(normalizedId);
    tableCreatedIds.add(table.createdId);
    blockers.push(
      ...(await validateRows(role, state, table, validator, formulaValidation)),
    );
  }
  return blockers;
}

async function validateRows(
  role: 'head' | 'draft',
  state: DraftRevisionState,
  table: DraftRevisionState['tables'][number],
  validator: JsonSchemaValidatorService,
  formulaValidation: FormulaValidationService,
): Promise<CandidateBlocker[]> {
  const blockers: CandidateBlocker[] = [];
  const rowIds = new Set<string>();
  const rowCreatedIds = new Set<string>();
  const schemaContext = prepareCandidateSchema(
    role,
    state,
    table,
    formulaValidation,
  );
  if (schemaContext.status === 'invalidSchema') {
    blockers.push(schemaContext.blocker);
  }
  for (const row of table.rows) {
    if (rowIds.has(row.id) || rowCreatedIds.has(row.createdId)) {
      blockers.push({
        code: 'IDENTITY_CONFLICT',
        role,
        tableCreatedId: table.createdId,
        rowCreatedId: row.createdId,
        identityScope: 'rowId',
        identityId: row.id,
        message: `Duplicate row identity '${row.id}'.`,
      });
    }
    rowIds.add(row.id);
    rowCreatedIds.add(row.createdId);
    if (
      !table.system &&
      schemaContext.status !== 'invalidSchema' &&
      !(await validRow(validator, row.data, schemaContext))
    ) {
      blockers.push({
        code: 'INVALID_RESULT_DATA',
        role,
        tableCreatedId: table.createdId,
        rowCreatedId: row.createdId,
        message: `Row '${row.id}' does not match its resulting schema.`,
      });
    }
  }
  return blockers;
}

function prepareCandidateSchema(
  role: 'head' | 'draft',
  state: DraftRevisionState,
  table: DraftRevisionState['tables'][number],
  formulaValidation: FormulaValidationService,
): CandidateSchemaContext {
  if (table.system) {
    return { status: 'system' };
  }
  const schemaTable = state.tables.find(({ id }) => id === SystemTables.Schema);
  const schemaRow = schemaTable?.rows.find(({ id }) => id === table.id);
  const schema = schemaRow?.data;
  if (!isRecord(schema)) {
    return { status: 'unavailable' };
  }
  const preparation = formulaValidation.prepareSchema(schema as JsonSchema);
  if (preparation.status === 'invalidSchema') {
    return {
      status: 'invalidSchema',
      blocker: {
        code: 'INVALID_FORMULA_SCHEMA',
        role,
        tableCreatedId: table.createdId,
        path: '',
        message: preparation.error.message,
      },
    };
  }
  return {
    status: 'prepared',
    sourceSchema: schema as JsonSchema,
    schemaHash: objectHash(schema),
    formulaValid: preparation.validation.isValid,
    resolvedSchema: preparation.schema,
  };
}

type CandidateSchemaContext =
  | { status: 'system' | 'unavailable' }
  | { status: 'invalidSchema'; blocker: CandidateBlocker }
  | {
      status: 'prepared';
      sourceSchema: JsonSchema;
      schemaHash: string;
      formulaValid: boolean;
      resolvedSchema: JsonSchema;
    };

async function validRow(
  validator: JsonSchemaValidatorService,
  data: unknown,
  context: CandidateSchemaContext,
): Promise<boolean> {
  if (context.status !== 'prepared') {
    return false;
  }
  const candidateData =
    context.formulaValid && isRecord(data)
      ? calculateFormulaData(
          context.resolvedSchema,
          structuredClone(data) as Record<string, unknown>,
        ).data
      : data;
  const result = await validator.validate(
    candidateData,
    context.sourceSchema as never,
    context.schemaHash,
  );
  return result.result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
