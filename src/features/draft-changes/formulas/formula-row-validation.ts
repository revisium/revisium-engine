import type { DraftRevisionStateRow } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { CandidateFormulaBlocker } from 'src/features/draft-changes/queries/impl/recompute-candidate-formulas.query';
import type { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import type { FormulaTableContext } from './formula-table';

export async function validateFormulaRow(
  context: FormulaTableContext,
  row: DraftRevisionStateRow,
  validator: JsonSchemaValidatorService,
): Promise<CandidateFormulaBlocker | undefined> {
  const validation = await validator.validate(
    row.data,
    context.schema as never,
    context.schemaHash,
  );
  if (validation.result) {
    return undefined;
  }
  const issue = validation.errors?.[0];
  return {
    code: 'INVALID_RESULT_DATA',
    role: context.role,
    tableCreatedId: context.table.createdId,
    rowCreatedId: row.createdId,
    path: issue?.instancePath ?? '',
    message: issue?.message ?? 'Candidate row does not match its schema.',
  };
}
