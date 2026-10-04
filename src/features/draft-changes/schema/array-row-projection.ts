import type {
  JsonArraySchema,
  JsonObjectSchema,
  JsonSchema,
  JsonValue,
} from '@revisium/schema-toolkit/types';
import type { FieldIdentityMap } from 'src/features/draft-changes/schema/field-lineage';
import { defaultRow } from 'src/features/draft-changes/schema/schema-table-projection';
import {
  escapePointer,
  isObject,
  readJsonPath,
  setJsonPath,
  type MaybeJson,
} from 'src/features/draft-changes/schema/json-value-path';
import {
  isArraySchema,
  isObjectSchema,
  schemaAtPath,
  schemaPathToDataPath,
} from 'src/features/draft-changes/schema/schema-field-values';

interface ArrayRemappingContext {
  sourceIdentities: FieldIdentityMap;
  targetPathByIdentity: Map<string, string>;
  refs: Record<string, JsonSchema>;
}

interface ArrayRemappingValue {
  value: JsonValue;
  sourceSchema: JsonSchema;
  targetSchema: JsonSchema;
  sourcePath: string;
  targetPath: string;
  targetBase: MaybeJson;
}

interface ArrayRemappingInput extends ArrayRemappingValue {
  context: ArrayRemappingContext;
  scope?: ArrayItemScope;
}

interface ArrayItemScope {
  targetPath: string;
  targetSchema: JsonSchema;
  output?: Record<string, JsonValue>;
}

export function remapArrayRow(input: ArrayRemappingInput): JsonValue {
  return remapValue(input);
}

function remapValue(input: ArrayRemappingInput): JsonValue {
  const {
    value,
    sourceSchema,
    targetSchema,
    sourcePath,
    targetPath,
    targetBase,
    context,
  } = input;
  if (
    isArraySchema(sourceSchema) &&
    isArraySchema(targetSchema) &&
    Array.isArray(value)
  ) {
    return remapArrayValue({
      context,
      value,
      sourceSchema,
      targetSchema,
      sourcePath,
      targetPath,
      targetBase,
      scope: input.scope,
    });
  }
  if (
    isObjectSchema(sourceSchema) &&
    isObjectSchema(targetSchema) &&
    isObject(value)
  ) {
    return remapObjectValue({
      context,
      value,
      sourceSchema,
      targetSchema,
      sourcePath,
      targetPath,
      targetBase,
      scope: input.scope,
    });
  }
  return structuredClone(value);
}

function remapArrayValue(
  input: ArrayRemappingInput & {
    value: JsonValue[];
    sourceSchema: JsonArraySchema;
    targetSchema: JsonArraySchema;
  },
): JsonValue[] {
  const {
    value,
    sourceSchema,
    targetSchema,
    sourcePath,
    targetPath,
    targetBase,
    context,
  } = input;
  const sourceItem = sourceSchema.items;
  const targetItem = targetSchema.items;
  if (!sourceItem || !targetItem) {
    return structuredClone(value);
  }
  const baseRows = Array.isArray(targetBase) ? targetBase : [];
  const defaultItem = defaultRow(targetItem, context.refs);
  return value.map((item, index) =>
    remapValue({
      context,
      value: item,
      sourceSchema: sourceItem,
      targetSchema: targetItem,
      sourcePath: `${sourcePath}/items`,
      targetPath: `${targetPath}/items`,
      targetBase: baseRows[index] ?? defaultItem,
      scope: { targetPath: `${targetPath}/items`, targetSchema: targetItem },
    }),
  );
}

function remapObjectValue(
  input: ArrayRemappingInput & {
    value: Record<string, JsonValue>;
    sourceSchema: JsonObjectSchema;
    targetSchema: JsonObjectSchema;
  },
): Record<string, JsonValue> {
  const {
    value,
    sourceSchema,
    targetSchema,
    sourcePath,
    targetPath,
    targetBase,
    context,
  } = input;
  const output: Record<string, JsonValue> = isObject(targetBase)
    ? structuredClone(targetBase)
    : {};
  const scope = input.scope ?? { targetPath, targetSchema };
  const scopeOutput = scope.output ?? output;
  const objectScope = { ...scope, output: scopeOutput };
  remapObjectFields({
    context,
    sourceValue: value,
    sourceSchema,
    sourcePath,
    scope: objectScope,
  });
  const currentPath = schemaPathToDataPath(
    targetPath.slice(scope.targetPath.length),
    [],
  );
  const currentOutput = readJsonPath(scopeOutput, currentPath);
  return isObject(currentOutput) ? currentOutput : output;
}

function remapObjectFields(input: {
  context: ArrayRemappingContext;
  sourceValue: Record<string, JsonValue>;
  sourceSchema: JsonObjectSchema;
  sourcePath: string;
  scope: ArrayItemScope & { output: Record<string, JsonValue> };
}): void {
  const { context, sourceValue, sourceSchema, sourcePath, scope } = input;
  for (const [sourceName, childSchema] of Object.entries(
    sourceSchema.properties,
  )) {
    remapObjectField({
      context,
      sourceName,
      childSchema,
      sourceValue,
      sourcePath,
      scope,
    });
  }
}

function remapObjectField(input: {
  context: ArrayRemappingContext;
  sourceName: string;
  childSchema: JsonSchema;
  sourceValue: Record<string, JsonValue>;
  sourcePath: string;
  scope: ArrayItemScope & { output: Record<string, JsonValue> };
}): void {
  const { sourceName, childSchema, sourceValue, sourcePath, scope, context } =
    input;
  const { sourceIdentities, targetPathByIdentity } = context;
  const sourceChildPath = `${sourcePath}/properties/${escapePointer(sourceName)}`;
  const identity = sourceIdentities.get(sourceChildPath);
  const targetChildPath = identity
    ? targetPathByIdentity.get(identity)
    : undefined;
  const sourceChildValue = sourceValue[sourceName];
  if (sourceChildValue === undefined) {
    return;
  }
  if (
    !identity ||
    targetChildPath === undefined ||
    !targetChildPath.startsWith(`${scope.targetPath}/properties/`)
  ) {
    if (isObjectSchema(childSchema) && isObject(sourceChildValue)) {
      remapObjectFields({
        context,
        sourceValue: sourceChildValue,
        sourceSchema: childSchema,
        sourcePath: sourceChildPath,
        scope,
      });
    }
    return;
  }
  const relativeTargetSchemaPath = targetChildPath.slice(
    scope.targetPath.length,
  );
  const targetChildSchema = schemaAtPath(
    scope.targetSchema,
    relativeTargetSchemaPath,
  );
  if (!targetChildSchema) {
    return;
  }
  const targetDataPath = schemaPathToDataPath(relativeTargetSchemaPath, []);
  const remapped = remapValue({
    context,
    value: sourceChildValue,
    sourceSchema: childSchema,
    targetSchema: targetChildSchema,
    sourcePath: sourceChildPath,
    targetPath: targetChildPath,
    targetBase: readJsonPath(scope.output, targetDataPath),
    scope,
  });
  const update = setJsonPath(scope.output, targetDataPath, remapped);
  if (update.representable && isObject(update.value)) {
    for (const key of Object.keys(scope.output)) {
      delete scope.output[key];
    }
    Object.assign(scope.output, update.value);
  }
}
