import { evaluateFormulas } from '@revisium/schema-toolkit/formula';
import type { EvaluateFormulasResult } from '@revisium/schema-toolkit/formula';
import type { JsonSchema } from '@revisium/schema-toolkit/types';

export interface FormulaDataCalculation extends EvaluateFormulasResult {
  data: Record<string, unknown>;
}

export function calculateFormulaData(
  schema: JsonSchema,
  data: Record<string, unknown>,
): FormulaDataCalculation {
  const result = evaluateFormulas(schema, data, {
    useDefaults: true,
  });
  return {
    ...result,
    data,
  };
}
