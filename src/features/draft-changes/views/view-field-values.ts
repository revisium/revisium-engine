import type { CandidateSchemaProjectionBinding } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import {
  escapePointer,
  unescapePointer,
} from 'src/features/share/json-pointer';
import type { View } from 'src/features/views/types';

export function mapNativeField(
  field: string,
  binding: CandidateSchemaProjectionBinding | undefined,
): string {
  if (!field.startsWith('data.') || !binding) {
    return field;
  }
  const sourcePointer = nativeFieldPointer(field);
  const mapping = binding.rowTargetFieldMappings
    .filter(
      ({ fromPath }) =>
        sourcePointer === fromPath || sourcePointer.startsWith(`${fromPath}/`),
    )
    .sort((left, right) => right.fromPath.length - left.fromPath.length)[0];
  if (!mapping) {
    return field;
  }
  const suffix = sourcePointer.slice(mapping.fromPath.length);
  const targetPointer = `${mapping.toPath}${suffix}`;
  const targetField = targetPointer
    .split('/')
    .slice(1)
    .map(unescapePointer)
    .join('.');
  return targetField ? `data.${targetField}` : 'data';
}

export function mapViewFields(
  view: View,
  binding: CandidateSchemaProjectionBinding | undefined,
): View {
  const output = structuredClone(view);
  if (Array.isArray(output.columns)) {
    output.columns = output.columns.map((column) =>
      mapFieldItem(column, binding),
    ) as View['columns'];
  }
  if (Array.isArray(output.sorts)) {
    output.sorts = output.sorts.map((sort) =>
      mapFieldItem(sort, binding),
    ) as View['sorts'];
  }
  if (output.filters !== undefined) {
    output.filters = mapFilterFields(
      output.filters,
      binding,
    ) as View['filters'];
  }
  return output;
}

export function mapFieldItem(
  item: unknown,
  binding: CandidateSchemaProjectionBinding | undefined,
): unknown {
  if (!isRecord(item) || typeof item.field !== 'string') {
    return structuredClone(item);
  }
  return {
    ...structuredClone(item),
    field: mapNativeField(item.field, binding),
  };
}

export function mapFilterFields(
  value: unknown,
  binding: CandidateSchemaProjectionBinding | undefined,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => mapFilterFields(item, binding));
  }
  if (!isRecord(value)) {
    return structuredClone(value);
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] =
      key === 'field' && typeof child === 'string'
        ? mapNativeField(child, binding)
        : mapFilterFields(child, binding);
  }
  return output;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nativeFieldPointer(field: string): string {
  return `/${field.slice('data.'.length).split('.').map(escapePointer).join('/')}`;
}
