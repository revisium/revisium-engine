import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { CustomSchemeKeywords } from 'src/features/share/schema/consts';

export const ANNOTATION_KEYWORDS = [
  'contentMediaType',
  'default',
  'deprecated',
  'description',
  'readOnly',
  'title',
] as const;

export type AnnotationKeyword = (typeof ANNOTATION_KEYWORDS)[number];

export type NormalizedLeafSchema = Readonly<Record<string, unknown>>;

type ReferencedTable =
  | { readonly identity: string }
  | { readonly unknownTableId: string };

const KEYWORDS_IGNORED_BY_LEAF_COMPARISON: ReadonlySet<string> = new Set([
  'title',
  'description',
  'deprecated',
]);
const ANNOTATIONS: ReadonlySet<string> = new Set(ANNOTATION_KEYWORDS);
const ITEMS = 'items';
const PROPERTIES = 'properties';

export function normalizedLeafSchema(
  schema: JsonSchema,
  tableIdentities: ReadonlyMap<string, string>,
): NormalizedLeafSchema {
  return new SchemaNormalizer(
    KEYWORDS_IGNORED_BY_LEAF_COMPARISON,
    tableIdentities,
  ).of(schema);
}

export function validatingSchema(
  schema: JsonSchema,
  tableIdentities: ReadonlyMap<string, string>,
): NormalizedLeafSchema {
  return new SchemaNormalizer(ANNOTATIONS, tableIdentities).of(schema);
}

export function annotationsDifferingBetween(
  head: SchemaWithTables,
  draft: SchemaWithTables,
): AnnotationKeyword[] {
  return ANNOTATION_KEYWORDS.filter(
    (annotation) =>
      !deepEqual(
        schemaWithAnnotationOnly(head, annotation),
        schemaWithAnnotationOnly(draft, annotation),
      ),
  );
}

export function ownAnnotationsDifferingBetween(
  head: JsonSchema,
  draft: JsonSchema,
): AnnotationKeyword[] {
  return ANNOTATION_KEYWORDS.filter(
    (annotation) =>
      !deepEqual(
        annotationOf(head, annotation),
        annotationOf(draft, annotation),
      ),
  );
}

export interface SchemaWithTables {
  readonly schema: JsonSchema;
  readonly tableIdentities: ReadonlyMap<string, string>;
}

function schemaWithAnnotationOnly(
  { schema, tableIdentities }: SchemaWithTables,
  annotation: AnnotationKeyword,
): NormalizedLeafSchema {
  return new SchemaNormalizer(
    new Set(ANNOTATION_KEYWORDS.filter((keyword) => keyword !== annotation)),
    tableIdentities,
  ).of(schema);
}

class SchemaNormalizer {
  constructor(
    private readonly ignoredKeywords: ReadonlySet<string>,
    private readonly tableIdentities: ReadonlyMap<string, string>,
  ) {}

  public of(schema: JsonSchema): NormalizedLeafSchema {
    const normalized: Record<string, unknown> = {};

    for (const [keyword, value] of Object.entries(schema)) {
      if (!this.ignoredKeywords.has(keyword)) {
        normalized[keyword] = this.normalizedKeyword(keyword, value);
      }
    }

    return normalized;
  }

  private normalizedKeyword(keyword: string, value: unknown): unknown {
    switch (keyword) {
      case CustomSchemeKeywords.ForeignKey:
        return referencedTable(value as string, this.tableIdentities);
      case ITEMS:
        return this.of(value as JsonSchema);
      case PROPERTIES:
        return this.normalizedProperties(value as Record<string, JsonSchema>);
      default:
        return value;
    }
  }

  private normalizedProperties(
    properties: Record<string, JsonSchema>,
  ): Record<string, NormalizedLeafSchema> {
    return Object.fromEntries(
      Object.entries(properties).map(([name, child]) => [name, this.of(child)]),
    );
  }
}

function annotationOf(
  schema: JsonSchema,
  annotation: AnnotationKeyword,
): unknown {
  return (schema as Readonly<Record<string, unknown>>)[annotation];
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
