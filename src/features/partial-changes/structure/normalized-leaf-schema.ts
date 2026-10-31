import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { CustomSchemeKeywords } from 'src/features/share/schema/consts';

export type NormalizedLeafSchema = Readonly<Record<string, unknown>>;

type ReferencedTable =
  | { readonly identity: string }
  | { readonly unknownTableId: string };

const ANNOTATIONS: ReadonlySet<string> = new Set([
  'title',
  'description',
  'deprecated',
]);
const ITEMS = 'items';
const PROPERTIES = 'properties';

export function normalizedLeafSchema(
  schema: JsonSchema,
  tableIdentities: ReadonlyMap<string, string>,
): NormalizedLeafSchema {
  const normalized: Record<string, unknown> = {};

  for (const [keyword, value] of Object.entries(schema)) {
    if (!ANNOTATIONS.has(keyword)) {
      normalized[keyword] = normalizedKeyword(keyword, value, tableIdentities);
    }
  }

  return normalized;
}

function normalizedKeyword(
  keyword: string,
  value: unknown,
  tableIdentities: ReadonlyMap<string, string>,
): unknown {
  switch (keyword) {
    case CustomSchemeKeywords.ForeignKey:
      return referencedTable(value as string, tableIdentities);
    case ITEMS:
      return normalizedLeafSchema(value as JsonSchema, tableIdentities);
    case PROPERTIES:
      return normalizedProperties(
        value as Record<string, JsonSchema>,
        tableIdentities,
      );
    default:
      return value;
  }
}

function normalizedProperties(
  properties: Record<string, JsonSchema>,
  tableIdentities: ReadonlyMap<string, string>,
): Record<string, NormalizedLeafSchema> {
  return Object.fromEntries(
    Object.entries(properties).map(([name, child]) => [
      name,
      normalizedLeafSchema(child, tableIdentities),
    ]),
  );
}

function referencedTable(
  tableId: string,
  tableIdentities: ReadonlyMap<string, string>,
): ReferencedTable {
  const identity = tableIdentities.get(tableId);

  if (identity === undefined) {
    return { unknownTableId: tableId };
  }

  return { identity };
}
