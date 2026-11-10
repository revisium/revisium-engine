import type {
  JsonPatchReplace,
  JsonSchema,
} from '@revisium/schema-toolkit/types';
import type { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

export interface ForeignKeySplit {
  readonly initSchema: JsonSchema;
  readonly patches: JsonPatchReplace[];
}

export function foreignKeySplitOf(
  schema: JsonSchema,
  deferredTargets: ReadonlySet<string>,
): ForeignKeySplit {
  const patches: JsonPatchReplace[] = [];
  const initSchema = withoutForeignKeysTo(schema, '', deferredTargets, patches);

  return {
    initSchema,
    patches: patches.sort((left, right) =>
      compareCodePoints(left.path, right.path),
    ),
  };
}

export function survivesSplit(
  rules: NativeSchemaRules,
  headSchema: JsonSchema,
  { initSchema, patches }: ForeignKeySplit,
): boolean {
  try {
    return schemasEqual(rules.patchedSchema(initSchema, patches), headSchema);
  } catch {
    return false;
  }
}

function withoutForeignKeysTo(
  schema: JsonSchema,
  pointer: string,
  targets: ReadonlySet<string>,
  patches: JsonPatchReplace[],
): JsonSchema {
  if ('$ref' in schema) {
    return schema;
  }

  if (schema.type === 'string' && isDeferred(schema.foreignKey, targets)) {
    patches.push({ op: 'replace', path: pointer, value: schema });
    const stripped = { ...schema };
    delete stripped.foreignKey;

    return stripped;
  }

  if (schema.type === 'object') {
    return {
      ...schema,
      properties: Object.fromEntries(
        Object.entries(schema.properties).map(([name, property]) => [
          name,
          withoutForeignKeysTo(
            property,
            `${pointer}/properties/${name}`,
            targets,
            patches,
          ),
        ]),
      ),
    };
  }

  if (schema.type === 'array') {
    return {
      ...schema,
      items: withoutForeignKeysTo(
        schema.items,
        `${pointer}/items`,
        targets,
        patches,
      ),
    };
  }

  return schema;
}

function isDeferred(
  foreignKey: string | undefined,
  targets: ReadonlySet<string>,
): boolean {
  return foreignKey !== undefined && targets.has(foreignKey);
}
