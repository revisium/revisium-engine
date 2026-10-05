import type {
  DraftRevisionState,
  DraftRevisionStateTable,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type {
  CandidateFormulaBlocker,
  CandidateFormulaEffect,
  CandidateFormulaError,
} from 'src/features/draft-changes/queries/impl/recompute-candidate-formulas.query';
import type { FormulaValidationService } from 'src/features/plugin/formula';
import type { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { formulaRowEffects, formulaRowErrors } from './formula-row-effects';
import { validateFormulaRow } from './formula-row-validation';
import { applyFormulaValues } from './formula-row-values';
import { prepareFormulaTable, type FormulaTableContext } from './formula-table';

export interface FormulaStateResult {
  state: DraftRevisionState;
  effects: CandidateFormulaEffect[];
  formulaErrors: CandidateFormulaError[];
  blockers: CandidateFormulaBlocker[];
}

export async function recomputeFormulaState(
  role: 'head' | 'draft',
  state: DraftRevisionState,
  formulaValidation: FormulaValidationService,
  validator: JsonSchemaValidatorService,
): Promise<FormulaStateResult> {
  const result = createFormulaStateResult(state);
  const schemaTable = state.tables.find(({ id }) => id === SystemTables.Schema);
  for (const table of state.tables) {
    if (table.system) {
      continue;
    }
    await collectTableFormulaChanges({
      role,
      table,
      schemaTable,
      formulaValidation,
      validator,
      result,
    });
  }
  return result;
}

function createFormulaStateResult(
  state: DraftRevisionState,
): FormulaStateResult {
  return { state, effects: [], formulaErrors: [], blockers: [] };
}

async function collectTableFormulaChanges(input: {
  role: 'head' | 'draft';
  table: DraftRevisionStateTable;
  schemaTable: DraftRevisionStateTable | undefined;
  formulaValidation: FormulaValidationService;
  validator: JsonSchemaValidatorService;
  result: FormulaStateResult;
}): Promise<void> {
  const { role, table, schemaTable, formulaValidation, validator, result } =
    input;
  const preparation = prepareFormulaTable({
    role,
    table,
    schemaTable,
    formulaValidation,
    validator,
  });
  if (preparation.status === 'blocked') {
    result.blockers.push(...preparation.blockers);
    return;
  }
  await collectRows(preparation.context, validator, result);
}

async function collectRows(
  context: FormulaTableContext,
  validator: JsonSchemaValidatorService,
  result: FormulaStateResult,
): Promise<void> {
  for (const row of context.table.rows) {
    const calculation = applyFormulaValues(context, row);
    const blocker = await validateFormulaRow(context, row, validator);
    if (blocker) {
      result.blockers.push(blocker);
    }
    result.effects.push(...formulaRowEffects(context, row, calculation));
    result.formulaErrors.push(...formulaRowErrors(context, row, calculation));
  }
}
