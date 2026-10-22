import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { isDeepStrictEqual } from 'node:util';
import {
  isSameOrInside,
  readAt,
  toPointer,
} from 'src/features/partial-changes-poc/catalogue/json-pointer';

export type LeafKind = 'value' | 'atomic' | 'computed' | 'publishedAt';

export type SchemaNode = Record<string, unknown>;

export interface SchemaLeaf {
  pointer: string;
  segments: string[];
  kind: LeafKind;
  node: SchemaNode;
}

export function collectSchemaLeaves(schema: JsonSchema): SchemaLeaf[] {
  const leaves: SchemaLeaf[] = [];
  collect(schema as unknown as SchemaNode, [], leaves);
  return leaves;
}

export function diffLeafPointers(
  leaves: readonly SchemaLeaf[],
  before: unknown,
  after: unknown,
): string[] {
  return leaves
    .filter((leaf) => storesValueInData(leaf))
    .filter(
      (leaf) =>
        !isDeepStrictEqual(
          readAt(before, leaf.segments),
          readAt(after, leaf.segments),
        ),
    )
    .map((leaf) => leaf.pointer);
}

export function storesValueInData(leaf: SchemaLeaf): boolean {
  return leaf.kind === 'value' || leaf.kind === 'atomic';
}

export function findComputedLeaf(
  leaves: readonly SchemaLeaf[],
  pointer: string,
): SchemaLeaf | undefined {
  return leaves.find(
    (leaf) => leaf.kind === 'computed' && isSameOrInside(pointer, leaf.pointer),
  );
}

function collect(
  node: SchemaNode,
  segments: string[],
  leaves: SchemaLeaf[],
): void {
  const properties = node.properties as Record<string, SchemaNode> | undefined;

  if (node.type === 'object' && properties && !('$ref' in node)) {
    for (const [key, child] of Object.entries(properties)) {
      collect(child, [...segments, key], leaves);
    }
    return;
  }

  leaves.push({
    pointer: toPointer(segments),
    segments,
    kind: leafKind(node),
    node,
  });
}

function leafKind(node: SchemaNode): LeafKind {
  if ('$ref' in node) {
    return refLeafKind(node.$ref);
  }

  if ('x-formula' in node) {
    return 'computed';
  }

  return node.type === 'array' ? 'atomic' : 'value';
}

function refLeafKind(ref: unknown): LeafKind {
  if (ref === SystemSchemaIds.File) {
    return 'atomic';
  }
  return ref === SystemSchemaIds.RowPublishedAt ? 'publishedAt' : 'computed';
}
