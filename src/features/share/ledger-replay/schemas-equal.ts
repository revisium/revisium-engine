import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';

export function schemasEqual(left: JsonSchema, right: JsonSchema): boolean {
  return deepEqual(left, right);
}
