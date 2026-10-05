import objectHash from 'object-hash';
import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonValue } from 'src/engine-prisma-types';
import type { DraftRevisionStateRow } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { calculateFormulaData } from 'src/features/plugin/formula/formula-calculation';
import type { FormulaTableContext } from './formula-table';

export interface FormulaRowCalculation {
  beforeData: JsonValue;
  data: JsonValue;
  values: Record<string, unknown>;
  errors: Array<{
    field: string;
    expression: string;
    error: string;
    defaultUsed: boolean;
  }>;
}

export function applyFormulaValues(
  context: FormulaTableContext,
  row: DraftRevisionStateRow,
): FormulaRowCalculation {
  const beforeData = structuredClone(row.data);
  const calculation = isRecord(row.data)
    ? calculateFormulaData(context.resolvedSchema, row.data)
    : { data: row.data, values: {}, errors: [] };

  if (
    Object.keys(calculation.values).length > 0 &&
    !deepEqual(beforeData, row.data)
  ) {
    row.hash = objectHash(row.data);
    row.schemaHash = context.schemaHash;
    row.readonly = false;
  }
  return {
    beforeData,
    data: row.data,
    values: calculation.values,
    errors: calculation.errors,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
