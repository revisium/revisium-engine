import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonValue } from 'src/engine-prisma-types';
import type { DraftRevisionStateRow } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type {
  CandidateFormulaEffect,
  CandidateFormulaError,
} from 'src/features/draft-changes/queries/impl/recompute-candidate-formulas.query';
import { formulaPathToPointer, readFormulaPath } from './formula-path';
import type { FormulaRowCalculation } from './formula-row-values';
import type { FormulaTableContext } from './formula-table';

export function formulaRowEffects(
  context: FormulaTableContext,
  row: DraftRevisionStateRow,
  calculation: FormulaRowCalculation,
): CandidateFormulaEffect[] {
  return Object.keys(calculation.values).flatMap((path) => {
    const before = readFormulaPath(calculation.beforeData, path);
    const after = readFormulaPath(calculation.data, path);
    if (sameValue(before, after)) {
      return [];
    }
    return [
      {
        role: context.role,
        tableCreatedId: context.table.createdId,
        rowCreatedId: row.createdId,
        path: formulaPathToPointer(path),
        beforeExists: before.exists,
        ...(before.exists ? { before: before.value as JsonValue } : {}),
        afterExists: after.exists,
        ...(after.exists ? { after: after.value as JsonValue } : {}),
      },
    ];
  });
}

export function formulaRowErrors(
  context: FormulaTableContext,
  row: DraftRevisionStateRow,
  calculation: FormulaRowCalculation,
): CandidateFormulaError[] {
  return calculation.errors.map((error) => ({
    role: context.role,
    tableCreatedId: context.table.createdId,
    rowCreatedId: row.createdId,
    path: formulaPathToPointer(error.field),
    expression: error.expression,
    error: error.error,
    defaultUsed: error.defaultUsed,
  }));
}

function sameValue(
  before: { exists: boolean; value?: unknown },
  after: { exists: boolean; value?: unknown },
): boolean {
  return (
    before.exists === after.exists &&
    (!before.exists || deepEqual(before.value, after.value))
  );
}
