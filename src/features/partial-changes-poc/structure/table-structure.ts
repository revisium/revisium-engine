import { SchemaTable } from '@revisium/schema-toolkit/lib';
import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import {
  isSameOrInside,
  toPointer,
  toSegments,
} from 'src/features/partial-changes-poc/catalogue/json-pointer';
import {
  collectSchemaLeaves,
  SchemaLeaf,
} from 'src/features/partial-changes-poc/catalogue/schema-leaves';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import { sameJson } from 'src/features/partial-changes-poc/structure/same-json';

export type SchemaRefs = Readonly<Record<string, JsonSchema>>;

export interface TableStructure {
  differs: boolean;
  pendingHistory?: HistoryPatches[];
  recorded: boolean;
  unchangedLeaves: SchemaLeaf[];
  changedPointers: string[];
  draftChangedValuePointers: string[];
}

export interface TableStructureInput {
  headSchema: JsonSchema;
  draftSchema: JsonSchema;
  headHistory: HistoryPatches[];
  draftHistory: HistoryPatches[];
  headIdentities: ReadonlyMap<string, string>;
  draftIdentities: ReadonlyMap<string, string>;
  refs: SchemaRefs;
}

interface TouchedPointer {
  pointer: string;
  replacesBelowOnly: boolean;
}

const ANNOTATIONS = new Set(['title', 'description', 'deprecated']);
const PROPERTY_SEGMENTS = 2;

export function analyzeTableStructure(
  input: TableStructureInput,
): TableStructure {
  const pendingHistory = pendingEntries(input.headHistory, input.draftHistory);
  const recorded =
    pendingHistory !== undefined &&
    sameJson(
      replaySchemaHistory(input.headSchema, pendingHistory, input.refs),
      input.draftSchema,
    );
  const draftLeaves = collectSchemaLeaves(input.draftSchema);

  if (sameJson(input.headSchema, input.draftSchema)) {
    return {
      differs: false,
      pendingHistory,
      recorded,
      unchangedLeaves: draftLeaves,
      changedPointers: [],
      draftChangedValuePointers: [],
    };
  }

  const headLeaves = new Map(
    collectSchemaLeaves(input.headSchema).map((leaf) => [leaf.pointer, leaf]),
  );
  const touched = touchedPointers(pendingHistory ?? []);
  const unchangedLeaves = draftLeaves.filter((leaf) =>
    isUnchanged(leaf, headLeaves.get(leaf.pointer), touched, input),
  );
  const unchanged = new Set(unchangedLeaves.map((leaf) => leaf.pointer));
  const changedPointers = [
    ...new Set([
      ...draftLeaves.map((leaf) => leaf.pointer),
      ...headLeaves.keys(),
    ]),
  ].filter((pointer) => !unchanged.has(pointer));
  const draftChangedValuePointers = draftLeaves
    .filter((leaf) => leaf.kind !== 'computed' && !unchanged.has(leaf.pointer))
    .map((leaf) => leaf.pointer);

  return {
    differs: true,
    pendingHistory,
    recorded,
    unchangedLeaves,
    changedPointers,
    draftChangedValuePointers,
  };
}

export function replaySchemaHistory(
  schema: JsonSchema,
  history: readonly HistoryPatches[],
  refs: SchemaRefs,
): JsonSchema | undefined {
  try {
    const table = new SchemaTable(structuredClone(schema), refs);
    for (const entry of history) {
      table.applyPatches(structuredClone(entry.patches));
    }
    return table.getSchema();
  } catch {
    return undefined;
  }
}

export function pendingPatches(
  history: readonly HistoryPatches[],
): JsonPatch[] {
  return history.flatMap((entry) => entry.patches);
}

function pendingEntries(
  head: HistoryPatches[],
  draft: HistoryPatches[],
): HistoryPatches[] | undefined {
  if (draft.length < head.length) {
    return undefined;
  }

  const prefixMatches = head.every((entry, index) =>
    sameJson(entry, draft[index]),
  );
  return prefixMatches ? draft.slice(head.length) : undefined;
}

function isUnchanged(
  leaf: SchemaLeaf,
  headLeaf: SchemaLeaf | undefined,
  touched: TouchedPointer[],
  input: TableStructureInput,
): boolean {
  if (!headLeaf) {
    return false;
  }

  const sameShape = sameJson(
    normalizedNode(headLeaf.node, input.headIdentities),
    normalizedNode(leaf.node, input.draftIdentities),
  );
  return sameShape && !touched.some((item) => touches(item, leaf.pointer));
}

function touches(item: TouchedPointer, leafPointer: string): boolean {
  if (item.replacesBelowOnly) {
    return (
      item.pointer !== leafPointer && isSameOrInside(leafPointer, item.pointer)
    );
  }

  return (
    isSameOrInside(leafPointer, item.pointer) ||
    isSameOrInside(item.pointer, leafPointer)
  );
}

function touchedPointers(history: readonly HistoryPatches[]): TouchedPointer[] {
  return pendingPatches(history).flatMap((patch): TouchedPointer[] => {
    if (patch.op === 'replace') {
      return [{ pointer: dataPointer(patch.path), replacesBelowOnly: true }];
    }

    const paths = patch.op === 'move' ? [patch.from, patch.path] : [patch.path];
    return paths.map((path) => ({
      pointer: dataPointer(path),
      replacesBelowOnly: false,
    }));
  });
}

export function dataPointer(schemaPath: string): string {
  const segments = toSegments(schemaPath);
  const dataSegments: string[] = [];
  let index = 0;

  while (segments[index] === 'properties') {
    const key = segments[index + 1];
    if (key === undefined) {
      break;
    }
    dataSegments.push(key);
    index += PROPERTY_SEGMENTS;
  }

  return toPointer(dataSegments);
}

function normalizedNode(
  node: unknown,
  identities: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => normalizedNode(item, identities));
  }

  if (node === null || typeof node !== 'object') {
    return node;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (ANNOTATIONS.has(key)) {
      continue;
    }
    result[key] = normalizedEntry(key, value, identities);
  }
  return result;
}

function normalizedEntry(
  key: string,
  value: unknown,
  identities: ReadonlyMap<string, string>,
): unknown {
  if (key === 'foreignKey' && typeof value === 'string') {
    return `identity:${identities.get(value) ?? value}`;
  }

  if (key === 'properties' && value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, child]) => [
        name,
        normalizedNode(child, identities),
      ]),
    );
  }

  return normalizedNode(value, identities);
}
