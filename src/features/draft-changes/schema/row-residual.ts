import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { ValidateFn } from '@revisium/schema-toolkit/lib';
import type {
  JsonArraySchema,
  JsonSchema,
  JsonValue,
} from '@revisium/schema-toolkit/types';
import type {
  DiscardedDataField,
  SchemaProjectionBlocker,
} from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { FieldIdentityMap } from 'src/features/draft-changes/schema/field-lineage';
import { compileRowValidator } from 'src/features/draft-changes/schema/row-validator';
import { defaultRow } from 'src/features/draft-changes/schema/schema-table-projection';
import { remapArrayRow } from 'src/features/draft-changes/schema/array-row-projection';
import {
  collectValues,
  isArraySchema,
  sameValue,
  schemaAtPath,
  schemaPathToDataPath,
  valueKey,
  type FieldValue,
} from 'src/features/draft-changes/schema/schema-field-values';
import {
  missingValue,
  readJsonPath,
  setJsonPath,
  escapePointer,
  type MaybeJson,
} from 'src/features/draft-changes/schema/json-value-path';

interface ResidualProjectionInput {
  fullSchema: JsonSchema;
  targetSchema: JsonSchema;
  fullRows: Array<{ createdId: string; data: JsonValue }>;
  targetRows: Array<{ createdId: string; data: JsonValue }>;
  draftRows: Array<{ createdId: string; data: JsonValue }>;
  fullIdentities: FieldIdentityMap;
  targetIdentities: FieldIdentityMap;
  discardedDataFields: DiscardedDataField[];
  refs: Record<string, JsonSchema>;
}

interface RowTransferContext {
  rowCreatedId: string;
  fullSchema: JsonSchema;
  targetSchema: JsonSchema;
  fullIdentities: FieldIdentityMap;
  targetPathByIdentity: Map<string, string>;
  discardedDataFields: DiscardedDataField[];
  sourceValues: Map<string, FieldValue>;
  draftValues: Map<string, FieldValue>;
  refs: Record<string, JsonSchema>;
}

interface FieldTransferInput extends RowTransferContext {
  changed: FieldValue;
  draftValue: MaybeJson;
  data: JsonValue;
}

export function transferRowResiduals(
  input: ResidualProjectionInput,
):
  | { rows: Array<{ createdId: string; data: JsonValue }> }
  | { blocker: SchemaProjectionBlocker } {
  const {
    fullSchema,
    targetSchema,
    fullRows,
    targetRows,
    draftRows,
    fullIdentities,
    targetIdentities,
    discardedDataFields,
    refs,
  } = input;
  if (
    deepEqual(fullSchema, targetSchema) &&
    sameIdentities(fullIdentities, targetIdentities)
  ) {
    return { rows: structuredClone(draftRows) };
  }

  const validate = compileRowValidator(targetSchema, refs);
  const validateFull = compileRowValidator(fullSchema, refs);
  const fullRowsById = new Map(
    fullRows.map((row) => [row.createdId, row.data]),
  );
  const targetRowsById = new Map(
    targetRows.map((row) => [row.createdId, row.data]),
  );
  const targetPathByIdentity = new Map(
    [...targetIdentities].map(([path, identity]) => [identity, path]),
  );
  const defaultFull = defaultRow(fullSchema, refs);
  const defaultTarget = defaultRow(targetSchema, refs);
  const projectedRows: Array<{ createdId: string; data: JsonValue }> = [];

  for (const draftRow of draftRows) {
    const fullBaseline = fullRowsById.get(draftRow.createdId) ?? defaultFull;
    const targetBaseline =
      targetRowsById.get(draftRow.createdId) ?? defaultTarget;
    const projected = projectDraftRow({
      draftRow,
      fullBaseline,
      targetBaseline,
      fullSchema,
      targetSchema,
      fullIdentities,
      targetPathByIdentity,
      discardedDataFields,
      refs,
      validate,
      validateFull,
    });
    if ('blocker' in projected) {
      return projected;
    }
    projectedRows.push(projected);
  }

  return { rows: projectedRows };
}

function projectDraftRow(input: {
  draftRow: { createdId: string; data: JsonValue };
  fullBaseline: JsonValue;
  targetBaseline: JsonValue;
  fullSchema: JsonSchema;
  targetSchema: JsonSchema;
  fullIdentities: FieldIdentityMap;
  targetPathByIdentity: Map<string, string>;
  discardedDataFields: DiscardedDataField[];
  refs: Record<string, JsonSchema>;
  validate: ValidateFn;
  validateFull: ValidateFn;
}):
  | { createdId: string; data: JsonValue }
  | { blocker: SchemaProjectionBlocker } {
  const {
    draftRow,
    fullBaseline,
    targetBaseline,
    fullSchema,
    targetSchema,
    fullIdentities,
    targetPathByIdentity,
    discardedDataFields,
    refs,
    validate,
    validateFull,
  } = input;
  const sourceValues = valueMap(
    collectValues(fullSchema, fullBaseline, fullIdentities),
  );
  const draftValues = valueMap(
    collectValues(fullSchema, draftRow.data, fullIdentities),
  );
  const transferred = transferFieldValues({
    rowCreatedId: draftRow.createdId,
    sourceValues,
    draftValues,
    data: targetBaseline,
    fullSchema,
    targetSchema,
    fullIdentities,
    targetPathByIdentity,
    discardedDataFields,
    refs,
  });
  if ('blocker' in transferred) {
    return transferred;
  }
  const retained = retainRejectedProperties({
    rowCreatedId: draftRow.createdId,
    draftData: draftRow.data,
    projectedData: transferred.data,
    fullSchema,
    fullIdentities,
    targetPathByIdentity,
    discardedDataFields,
    validateFull,
  });
  if ('blocker' in retained) {
    return retained;
  }
  const withUnknownValues = retained.data;
  const invalid = getInvalidIssue(validate, withUnknownValues);
  if (invalid !== undefined) {
    const mappedDraftPath = mapTargetPathToDraftPath(
      invalid.path,
      draftValues,
      targetPathByIdentity,
    );
    const draftPath =
      containingArrayPath(mappedDraftPath, draftValues, fullSchema) ??
      mappedDraftPath;
    const restored = restoreAuthorizedArray({
      rowCreatedId: draftRow.createdId,
      projectedData: withUnknownValues,
      targetBaseline,
      invalidDraftPath: draftPath,
      draftValues,
      fullSchema,
      targetSchema,
      targetPathByIdentity,
      discardedDataFields,
      validate,
    });
    if (restored) {
      return { createdId: draftRow.createdId, data: restored };
    }
    return {
      blocker: validationBlocker(
        draftRow.createdId,
        draftPath,
        invalid.keyword !== 'additionalProperties',
      ),
    };
  }
  return { createdId: draftRow.createdId, data: withUnknownValues };
}

function retainRejectedProperties(input: {
  rowCreatedId: string;
  draftData: JsonValue;
  projectedData: JsonValue;
  fullSchema: JsonSchema;
  fullIdentities: FieldIdentityMap;
  targetPathByIdentity: Map<string, string>;
  discardedDataFields: DiscardedDataField[];
  validateFull: ValidateFn;
}): { data: JsonValue } | { blocker: SchemaProjectionBlocker } {
  const {
    rowCreatedId,
    draftData,
    fullSchema,
    fullIdentities,
    targetPathByIdentity,
    discardedDataFields,
    validateFull,
  } = input;
  validateFull(draftData);
  const errors = validateFull.errors ?? [];
  let projectedData = input.projectedData;
  const values = collectValues(fullSchema, draftData, fullIdentities);
  for (const error of errors) {
    const retained = retainAdditionalProperty({
      rowCreatedId,
      draftData,
      projectedData,
      discardedDataFields,
      values,
      targetPathByIdentity,
      error,
    });
    if ('blocker' in retained) {
      return retained;
    }
    projectedData = retained.data;
  }
  return { data: projectedData };
}

function retainAdditionalProperty(input: {
  rowCreatedId: string;
  draftData: JsonValue;
  projectedData: JsonValue;
  discardedDataFields: DiscardedDataField[];
  values: FieldValue[];
  targetPathByIdentity: Map<string, string>;
  error: NonNullable<ValidateFn['errors']>[number];
}): { data: JsonValue } | { blocker: SchemaProjectionBlocker } {
  const { error } = input;
  const property = error.params.additionalProperty;
  if (
    error.keyword !== 'additionalProperties' ||
    typeof property !== 'string'
  ) {
    return { data: input.projectedData };
  }
  const sourceParent = error.instancePath;
  const sourcePath = appendPointer(sourceParent, property);
  if (
    isCoveredByExplicitDiscard(
      input.rowCreatedId,
      sourcePath,
      input.discardedDataFields,
    )
  ) {
    return { data: input.projectedData };
  }
  const sourceValue = readJsonPath(input.draftData, sourcePath);
  if (sourceValue === missingValue) {
    return { data: input.projectedData };
  }
  const descendant = input.values.find(
    (field) =>
      field.dataPath.startsWith(`${sourceParent}/`) &&
      input.targetPathByIdentity.has(field.identity),
  );
  if (!descendant) {
    return {
      blocker: unrepresentableBlocker(
        input.rowCreatedId,
        sourcePath,
        `Draft value at '${sourcePath}' has no matching field in the retained schema.`,
        false,
      ),
    };
  }
  return setUnknownValueAtMappedParent(
    input,
    descendant,
    property,
    sourceValue,
  );
}

function setUnknownValueAtMappedParent(
  input: Parameters<typeof retainAdditionalProperty>[0],
  descendant: FieldValue,
  property: string,
  sourceValue: MaybeJson,
): { data: JsonValue } | { blocker: SchemaProjectionBlocker } {
  const targetSchemaPath = input.targetPathByIdentity.get(descendant.identity);
  if (!targetSchemaPath) {
    return {
      blocker: unrepresentableBlocker(
        input.rowCreatedId,
        descendant.dataPath,
        `Draft value at '${descendant.dataPath}' has no matching field in the retained schema.`,
        false,
      ),
    };
  }
  const targetDescendant = schemaPathToDataPath(
    targetSchemaPath,
    descendant.indexPath,
  );
  const suffixLength =
    pointerSegments(descendant.dataPath).length -
    pointerSegments(input.error.instancePath).length;
  const targetSegments = pointerSegments(targetDescendant);
  const targetParent = pointerFromSegments(
    targetSegments.slice(0, Math.max(0, targetSegments.length - suffixLength)),
  );
  const current = readJsonPath(input.projectedData, targetParent);
  if (!isObjectValue(current)) {
    return {
      blocker: unrepresentableBlocker(
        input.rowCreatedId,
        appendPointer(targetParent, property),
        `Draft value at '${appendPointer(targetParent, property)}' cannot be retained in the projected row.`,
        false,
      ),
    };
  }
  if (Object.prototype.hasOwnProperty.call(current, property)) {
    return {
      blocker: unrepresentableBlocker(
        input.rowCreatedId,
        sourcePathFromError(input.error, property),
        `Draft value at '${sourcePathFromError(input.error, property)}' conflicts with a retained field.`,
        false,
      ),
    };
  }
  const updated = setJsonPath(
    input.projectedData,
    appendPointer(targetParent, property),
    sourceValue,
  );
  return updated.representable
    ? { data: updated.value }
    : {
        blocker: unrepresentableBlocker(
          input.rowCreatedId,
          appendPointer(targetParent, property),
          `Draft value at '${appendPointer(targetParent, property)}' cannot be retained in the projected row.`,
          false,
        ),
      };
}

function sourcePathFromError(
  error: NonNullable<ValidateFn['errors']>[number],
  property: string,
): string {
  return appendPointer(error.instancePath, property);
}

function appendPointer(path: string, segment: string): string {
  return `${path}/${escapePointer(segment)}`;
}

function pointerSegments(path: string): string[] {
  return path === '' ? [] : path.split('/').slice(1);
}

function pointerFromSegments(segments: string[]): string {
  return segments.length === 0 ? '' : `/${segments.join('/')}`;
}

function isObjectValue(value: MaybeJson): value is Record<string, JsonValue> {
  return (
    value !== missingValue &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function valueMap(fields: FieldValue[]): Map<string, FieldValue> {
  return new Map(fields.map((field) => [valueKey(field), field]));
}

function transferFieldValues(
  input: RowTransferContext & { data: JsonValue },
): { data: JsonValue } | { blocker: SchemaProjectionBlocker } {
  const { sourceValues, draftValues } = input;
  const identities = new Set([...sourceValues.keys(), ...draftValues.keys()]);
  let data = structuredClone(input.data);
  const remappedArrays: string[] = [];
  for (const identity of identities) {
    const source = sourceValues.get(identity);
    const draft = draftValues.get(identity);
    const changed = draft ?? source;
    if (!changed || isCoveredByRemappedArray(changed, remappedArrays)) {
      continue;
    }
    const sourceValue = source ? source.value : missingValue;
    const draftValue = draft ? draft.value : missingValue;
    if (sameValue(sourceValue, draftValue)) {
      continue;
    }
    const transfer = transferFieldValue({
      ...input,
      changed,
      draftValue,
      data,
    });
    if ('blocker' in transfer) {
      return transfer;
    }
    data = transfer.data;
    if (transfer.remappedArrayPath !== undefined) {
      remappedArrays.push(transfer.remappedArrayPath);
    }
  }
  return { data };
}

function transferFieldValue(
  input: FieldTransferInput,
):
  | { data: JsonValue; remappedArrayPath?: string }
  | { blocker: SchemaProjectionBlocker } {
  const { changed, rowCreatedId, draftValue } = input;
  const targetPath = input.targetPathByIdentity.get(changed.identity);
  const dataPath =
    targetPath !== undefined
      ? schemaPathToDataPath(targetPath, changed.indexPath)
      : changed.dataPath;
  const sourceSchema = schemaAtPath(input.fullSchema, changed.schemaPath);
  const targetSchema =
    targetPath === undefined
      ? undefined
      : schemaAtPath(input.targetSchema, targetPath);
  if (
    isExplicitlyDiscarded(
      rowCreatedId,
      changed.dataPath,
      input.discardedDataFields,
    ) &&
    (!isArraySchema(sourceSchema) || targetPath === undefined)
  ) {
    return { data: input.data };
  }
  if (
    targetPath === undefined &&
    isCoveredByExplicitDiscard(
      rowCreatedId,
      changed.dataPath,
      input.discardedDataFields,
    )
  ) {
    return { data: input.data };
  }
  if (
    isArraySchema(sourceSchema) &&
    isArraySchema(targetSchema) &&
    targetPath !== undefined &&
    draftValue !== missingValue &&
    Array.isArray(draftValue)
  ) {
    const blocker = findUnrepresentableArrayValue(input, changed.dataPath);
    if (blocker) {
      return { blocker };
    }
    return transferArrayValue({
      context: input,
      sourceSchema,
      targetSchema,
      targetPath,
      dataPath,
    });
  }
  if (targetPath === undefined) {
    return {
      blocker: unrepresentableBlocker(
        rowCreatedId,
        dataPath,
        `Draft value at '${dataPath}' has no matching field in the retained schema.`,
      ),
    };
  }
  const update = setJsonPath(input.data, dataPath, draftValue);
  if (!update.representable) {
    return {
      blocker: unrepresentableBlocker(
        rowCreatedId,
        dataPath,
        `Draft value at '${dataPath}' cannot be represented in the retained row.`,
      ),
    };
  }
  return { data: update.value };
}

function transferArrayValue(input: {
  context: FieldTransferInput;
  sourceSchema: JsonArraySchema;
  targetSchema: JsonArraySchema;
  targetPath: string;
  dataPath: string;
}):
  | { data: JsonValue; remappedArrayPath?: string }
  | { blocker: SchemaProjectionBlocker } {
  const { context, sourceSchema, targetSchema, targetPath, dataPath } = input;
  const baseValue = readJsonPath(context.data, dataPath);
  const mappedArray = remapArrayRow({
    value: context.draftValue as JsonValue[],
    sourceSchema,
    targetSchema,
    sourcePath: context.changed.schemaPath,
    targetPath,
    targetBase: baseValue,
    context: {
      sourceIdentities: context.fullIdentities,
      targetPathByIdentity: context.targetPathByIdentity,
      refs: context.refs,
    },
  });
  const update = setJsonPath(context.data, dataPath, mappedArray);
  if (!update.representable) {
    return {
      blocker: {
        code: 'UNREPRESENTABLE_REMAINDER',
        message: `Draft array at '${dataPath}' cannot be represented in the retained schema.`,
        rowCreatedId: context.rowCreatedId,
        path: dataPath,
      },
    };
  }
  return { data: update.value, remappedArrayPath: context.changed.dataPath };
}

function findUnrepresentableArrayValue(
  input: Parameters<typeof transferFieldValue>[0],
  arrayPath: string,
): SchemaProjectionBlocker | undefined {
  const identities = new Set([
    ...input.sourceValues.keys(),
    ...input.draftValues.keys(),
  ]);
  for (const identity of identities) {
    const source = input.sourceValues.get(identity);
    const draft = input.draftValues.get(identity);
    const changed = draft ?? source;
    if (!changed || !isDescendantPath(changed.dataPath, arrayPath)) {
      continue;
    }
    if (input.targetPathByIdentity.has(changed.identity)) {
      continue;
    }
    const sourceValue = source ? source.value : missingValue;
    const draftValue = draft ? draft.value : missingValue;
    if (draftValue === missingValue || sameValue(sourceValue, draftValue)) {
      continue;
    }
    if (
      isExplicitlyDiscarded(
        input.rowCreatedId,
        arrayPath,
        input.discardedDataFields,
      )
    ) {
      continue;
    }
    return unrepresentableBlocker(
      input.rowCreatedId,
      arrayPath,
      `Draft array at '${arrayPath}' contains data with no matching field in the retained schema.`,
    );
  }
  return undefined;
}

function isDescendantPath(path: string, parent: string): boolean {
  if (path === parent) {
    return true;
  }
  const prefix = parent === '' ? '/' : `${parent}/`;
  return path.startsWith(prefix);
}

function isCoveredByRemappedArray(
  value: FieldValue,
  remappedArrays: string[],
): boolean {
  return remappedArrays.some((path) => value.dataPath.startsWith(`${path}/`));
}

function unrepresentableBlocker(
  rowCreatedId: string,
  path: string,
  message: string,
  requireDiscardConfirmation = true,
): SchemaProjectionBlocker {
  return {
    code: 'UNREPRESENTABLE_REMAINDER',
    message,
    rowCreatedId,
    path,
    ...(requireDiscardConfirmation
      ? { requiredDataFields: [{ rowCreatedId, path }] }
      : {}),
  };
}

function getInvalidPath(
  validate: ValidateFn,
  data: JsonValue,
): string | undefined {
  return validate(data)
    ? undefined
    : (validate.errors?.[0]?.instancePath ?? '');
}

function getInvalidIssue(
  validate: ValidateFn,
  data: JsonValue,
): { path: string; keyword: string | undefined } | undefined {
  if (validate(data)) {
    return undefined;
  }
  const error = validate.errors?.[0];
  return { path: error?.instancePath ?? '', keyword: error?.keyword };
}

function validationBlocker(
  rowCreatedId: string,
  path: string,
  requireDiscardConfirmation = true,
): SchemaProjectionBlocker {
  return {
    code: 'UNREPRESENTABLE_REMAINDER',
    message: `Draft row '${rowCreatedId}' does not satisfy the retained schema at '${path}'.`,
    rowCreatedId,
    path,
    ...(requireDiscardConfirmation
      ? { requiredDataFields: [{ rowCreatedId, path }] }
      : {}),
  };
}

function isExplicitlyDiscarded(
  rowCreatedId: string,
  path: string,
  discardedDataFields: DiscardedDataField[],
): boolean {
  return discardedDataFields.some(
    (field) => field.rowCreatedId === rowCreatedId && field.path === path,
  );
}

function isCoveredByExplicitDiscard(
  rowCreatedId: string,
  path: string,
  discardedDataFields: DiscardedDataField[],
): boolean {
  return discardedDataFields.some(
    (field) =>
      field.rowCreatedId === rowCreatedId &&
      (path === field.path || path.startsWith(`${field.path}/`)),
  );
}

function mapTargetPathToDraftPath(
  targetDataPath: string,
  draftValues: Map<string, FieldValue>,
  targetPathByIdentity: Map<string, string>,
): string {
  for (const field of draftValues.values()) {
    const targetSchemaPath = targetPathByIdentity.get(field.identity);
    if (
      targetSchemaPath !== undefined &&
      schemaPathToDataPath(targetSchemaPath, field.indexPath) === targetDataPath
    ) {
      return field.dataPath;
    }
  }
  return targetDataPath;
}

function restoreAuthorizedArray(input: {
  rowCreatedId: string;
  projectedData: JsonValue;
  targetBaseline: JsonValue;
  invalidDraftPath: string;
  draftValues: Map<string, FieldValue>;
  fullSchema: JsonSchema;
  targetSchema: JsonSchema;
  targetPathByIdentity: Map<string, string>;
  discardedDataFields: DiscardedDataField[];
  validate: ValidateFn;
}): JsonValue | undefined {
  const {
    rowCreatedId,
    projectedData,
    targetBaseline,
    invalidDraftPath,
    draftValues,
    fullSchema,
    targetSchema,
    targetPathByIdentity,
    discardedDataFields,
    validate,
  } = input;
  for (const field of discardedDataFields) {
    if (
      field.rowCreatedId !== rowCreatedId ||
      !isDescendantPath(invalidDraftPath, field.path)
    ) {
      continue;
    }
    const arrayField = [...draftValues.values()].find(
      (candidate) =>
        candidate.dataPath === field.path &&
        isArraySchema(schemaAtPath(fullSchema, candidate.schemaPath)),
    );
    const targetArrayPath = arrayField
      ? targetPathByIdentity.get(arrayField.identity)
      : undefined;
    if (
      !arrayField ||
      targetArrayPath === undefined ||
      !isArraySchema(schemaAtPath(targetSchema, targetArrayPath))
    ) {
      continue;
    }
    const targetDataPath = schemaPathToDataPath(
      targetArrayPath,
      arrayField.indexPath,
    );
    const baselineArray = readJsonPath(targetBaseline, targetDataPath);
    if (!Array.isArray(baselineArray)) {
      continue;
    }
    const restored = setJsonPath(projectedData, targetDataPath, baselineArray);
    if (
      restored.representable &&
      getInvalidPath(validate, restored.value) === undefined
    ) {
      return restored.value;
    }
  }
  return undefined;
}

function containingArrayPath(
  dataPath: string,
  fields: Map<string, FieldValue>,
  schema: JsonSchema,
): string | undefined {
  return [...fields.values()]
    .filter(
      (field) =>
        isArraySchema(schemaAtPath(schema, field.schemaPath)) &&
        isDescendantPath(dataPath, field.dataPath),
    )
    .sort((left, right) => left.dataPath.length - right.dataPath.length)[0]
    ?.dataPath;
}

function sameIdentities(
  left: FieldIdentityMap,
  right: FieldIdentityMap,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  return [...left].every(([path, identity]) => right.get(path) === identity);
}
