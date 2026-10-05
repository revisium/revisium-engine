import {
  createJsonSchemaStore,
  RevisiumValidator,
} from '@revisium/schema-toolkit/lib';
import { validateSchemaFormulas } from '@revisium/schema-toolkit/formula';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { ValidateFn } from '@revisium/schema-toolkit/lib';
import { calculateFormulaData } from 'src/features/plugin/formula/formula-calculation';

export function compileRowValidator(
  schema: JsonSchema,
  refs: Record<string, JsonSchema>,
): ValidateFn {
  const resolvedSchema = createJsonSchemaStore(schema, refs).getPlainSchema({
    skip$Ref: true,
  });
  const validate = new RevisiumValidator().compile(resolvedSchema);
  const hasValidFormulas = validateSchemaFormulas(resolvedSchema).isValid;
  const validateComputed: ValidateFn = (data) => {
    const candidate =
      hasValidFormulas && isRecord(data)
        ? calculateFormulaData(
            resolvedSchema,
            structuredClone(data) as Record<string, unknown>,
          ).data
        : data;
    const result = validate(candidate);
    validateComputed.errors = validate.errors;
    return result;
  };
  validateComputed.errors = null;
  return validateComputed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
