import {
  createJsonSchemaStore,
  RevisiumValidator,
} from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { ValidateFn } from '@revisium/schema-toolkit/lib';

export function compileRowValidator(
  schema: JsonSchema,
  refs: Record<string, JsonSchema>,
): ValidateFn {
  const resolvedSchema = createJsonSchemaStore(schema, refs).getPlainSchema({
    skip$Ref: true,
  });
  return new RevisiumValidator().compile(resolvedSchema);
}
