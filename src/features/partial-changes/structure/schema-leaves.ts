import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  JsonSchemaTypeName,
  type JsonObjectSchema,
  type JsonSchema,
} from '@revisium/schema-toolkit/types';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import { CustomSchemeKeywords } from 'src/features/share/schema/consts';

export type LeafKind = 'value' | 'atomic' | 'publishedAt' | 'computed';

export interface SchemaLeaf {
  readonly pointer: JsonPointer;
  readonly kind: LeafKind;
  readonly schema: JsonSchema;
}

const PROPERTIES = 'properties';

export class SchemaLeaves {
  private readonly leavesByPointer: ReadonlyMap<string, SchemaLeaf>;

  private constructor(public readonly all: readonly SchemaLeaf[]) {
    this.leavesByPointer = new Map(
      all.map((leaf) => [leaf.pointer.toString(), leaf]),
    );
  }

  public static of(schema: JsonSchema): SchemaLeaves {
    const publishedAtRefs = countPublishedAtRefs(schema);

    return new SchemaLeaves(
      collectLeaves(schema, JsonPointer.root, publishedAtRefs),
    );
  }

  public at(pointer: JsonPointer): SchemaLeaf | undefined {
    return this.leavesByPointer.get(pointer.toString());
  }

  public publishedAtField(): SchemaLeaf | undefined {
    return this.all.find((leaf) => leaf.kind === 'publishedAt');
  }
}

export function dataPointerOfSchemaPath(schemaPath: string): JsonPointer {
  return dataSegmentsOf(JsonPointer.parse(schemaPath).segments).reduce(
    (pointer, name) => pointer.child(name),
    JsonPointer.root,
  );
}

function dataSegmentsOf(schemaSegments: readonly string[]): string[] {
  const [keyword, name, ...rest] = schemaSegments;

  if (keyword !== PROPERTIES || name === undefined) {
    return [];
  }

  return [name, ...dataSegmentsOf(rest)];
}

function collectLeaves(
  node: JsonSchema,
  pointer: JsonPointer,
  publishedAtRefs: number,
): SchemaLeaf[] {
  if (isObjectNode(node)) {
    return Object.entries(node.properties).flatMap(([name, child]) =>
      collectLeaves(child, pointer.child(name), publishedAtRefs),
    );
  }

  return [{ pointer, kind: leafKindOf(node, publishedAtRefs), schema: node }];
}

function leafKindOf(node: JsonSchema, publishedAtRefs: number): LeafKind {
  if ('$ref' in node) {
    return refLeafKind(node.$ref, publishedAtRefs);
  }

  if (CustomSchemeKeywords.XFormula in node) {
    return 'computed';
  }

  if (node.type === JsonSchemaTypeName.Array) {
    return 'atomic';
  }

  return 'value';
}

function refLeafKind(ref: string, publishedAtRefs: number): LeafKind {
  if (ref === SystemSchemaIds.File) {
    return 'atomic';
  }

  if (ref === SystemSchemaIds.RowPublishedAt && publishedAtRefs === 1) {
    return 'publishedAt';
  }

  return 'computed';
}

function countPublishedAtRefs(node: JsonSchema): number {
  if ('$ref' in node) {
    return node.$ref === SystemSchemaIds.RowPublishedAt ? 1 : 0;
  }

  if (node.type === JsonSchemaTypeName.Array) {
    return countPublishedAtRefs(node.items);
  }

  if (node.type === JsonSchemaTypeName.Object) {
    return Object.values(node.properties).reduce(
      (count, child) => count + countPublishedAtRefs(child),
      0,
    );
  }

  return 0;
}

function isObjectNode(node: JsonSchema): node is JsonObjectSchema {
  return !('$ref' in node) && node.type === JsonSchemaTypeName.Object;
}
