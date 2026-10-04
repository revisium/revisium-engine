import objectHash from 'object-hash';
import { deepEqual, SchemaTable } from '@revisium/schema-toolkit/lib';
import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import type {
  SchemaEffectRef,
  SchemaProjectionBlocker,
} from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';

export interface HistoryGroup {
  historyIndex: number;
  source: HistoryPatches;
  patches: JsonPatch[];
  patchIndexes: number[];
}

export interface HistoryPartition {
  all: HistoryGroup[];
  selected: HistoryGroup[];
  remaining: HistoryGroup[];
  selectedEffects: SchemaEffectRef[];
}

export function validateSchemaHistory(
  terminalSchema: JsonSchema,
  history: HistoryPatches[],
  refs: Record<string, JsonSchema>,
): SchemaProjectionBlocker | undefined {
  const rootEntry = history[0];
  if (!rootEntry) {
    return blocker(
      'SCHEMA_HISTORY_MISSING',
      'Schema history has no initial schema entry.',
    );
  }
  const initialSchema = getInitialSchema(history);
  if (!initialSchema) {
    return blocker(
      'SCHEMA_HISTORY_INVALID',
      'Initial schema history must contain exactly one root schema add patch.',
    );
  }

  try {
    if (objectHash(initialSchema) !== rootEntry.hash) {
      return blocker(
        'SCHEMA_HISTORY_INVALID',
        'Initial schema history hash is invalid.',
      );
    }
    let replayedSchema = structuredClone(initialSchema);
    for (const [offset, entry] of history.slice(1).entries()) {
      const table = new SchemaTable(structuredClone(replayedSchema), refs);
      table.applyPatches(structuredClone(entry.patches));
      replayedSchema = table.getSchema();
      const replayedHash = objectHash(replayedSchema);
      if (replayedHash !== entry.hash) {
        return blocker(
          'SCHEMA_HISTORY_INVALID',
          `Schema history entry ${offset + 1} has an invalid hash.`,
        );
      }
    }
    if (!deepEqual(replayedSchema, terminalSchema)) {
      return blocker(
        'SCHEMA_PROVENANCE_MISMATCH',
        'Schema history does not produce the supplied revision schema.',
      );
    }
    return undefined;
  } catch {
    return blocker(
      'SCHEMA_HISTORY_INVALID',
      'Schema history contains patches that cannot be replayed.',
    );
  }
}

export function validateHistoryPrefix(
  headHistory: HistoryPatches[],
  draftHistory: HistoryPatches[],
): SchemaProjectionBlocker | undefined {
  if (headHistory.length > draftHistory.length) {
    return blocker(
      'SCHEMA_HISTORY_PREFIX_MISMATCH',
      'Head schema history is not a prefix of Draft schema history.',
    );
  }
  for (let index = 0; index < headHistory.length; index += 1) {
    const head = headHistory[index];
    const draft = draftHistory[index];
    if (!head || !draft) {
      return blocker(
        'SCHEMA_HISTORY_PREFIX_MISMATCH',
        'Head schema history is not a prefix of Draft schema history.',
      );
    }
    if (!deepEqual(head, draft)) {
      return blocker(
        'SCHEMA_HISTORY_PREFIX_MISMATCH',
        'Head schema history is not a prefix of Draft schema history.',
      );
    }
  }
  return undefined;
}

export function partitionHistory(
  history: HistoryPatches[],
  pendingStart: number,
  effects: SchemaEffectRef[],
): HistoryPartition | SchemaProjectionBlocker {
  const selectedIndexes = new Set<string>();
  for (const effect of effects) {
    if (
      !Number.isInteger(effect.historyIndex) ||
      !Number.isInteger(effect.patchIndex) ||
      effect.historyIndex < pendingStart ||
      effect.historyIndex >= history.length ||
      effect.patchIndex < 0 ||
      effect.patchIndex >= (history[effect.historyIndex]?.patches.length ?? 0)
    ) {
      return blocker(
        'INVALID_EFFECT_REFERENCE',
        'A schema effect reference is outside Draft pending history.',
      );
    }
    selectedIndexes.add(effectKey(effect));
  }

  const all = history.slice(pendingStart).map((source, offset) => ({
    historyIndex: pendingStart + offset,
    source,
    patches: structuredClone(source.patches),
    patchIndexes: source.patches.map((_patch, patchIndex) => patchIndex),
  }));
  const selected = partitionGroups(all, selectedIndexes, true);
  const remaining = partitionGroups(all, selectedIndexes, false);

  const selectedEffects = [...selectedIndexes]
    .map((key) => {
      const separator = key.indexOf(':');
      const historyIndex = Number(key.slice(0, separator));
      const patchIndex = Number(key.slice(separator + 1));
      return { historyIndex, patchIndex };
    })
    .sort(
      (left, right) =>
        left.historyIndex - right.historyIndex ||
        left.patchIndex - right.patchIndex,
    );
  return { all, selected, remaining, selectedEffects };
}

export function replayHistorySchema(
  initialSchema: JsonSchema,
  groups: HistoryGroup[],
  refs: Record<string, JsonSchema>,
): { schema: JsonSchema; history: HistoryPatches[] } | SchemaProjectionBlocker {
  if (groups.length === 0) {
    return { schema: structuredClone(initialSchema), history: [] };
  }
  try {
    let currentSchema = structuredClone(initialSchema);
    const history: HistoryPatches[] = [];
    for (const group of groups) {
      const table = new SchemaTable(structuredClone(currentSchema), refs);
      table.applyPatches(structuredClone(group.patches));
      currentSchema = table.getSchema();
      history.push({
        ...structuredClone(group.source),
        patches: structuredClone(group.patches),
        hash: objectHash(currentSchema),
      });
    }
    return { schema: currentSchema, history };
  } catch {
    return blocker(
      'DEPENDENT_EFFECT_SPLIT',
      'Selected schema effects cannot be replayed from the target schema.',
    );
  }
}

function getInitialSchema(history: HistoryPatches[]): JsonSchema | undefined {
  if (history.length === 0) {
    return undefined;
  }
  const rootEntry = history[0];
  if (!rootEntry) {
    return undefined;
  }
  if (rootEntry.patches.length !== 1) {
    return undefined;
  }
  const rootPatch = rootEntry.patches[0];
  if (!rootPatch || rootPatch.op !== 'add' || rootPatch.path !== '') {
    return undefined;
  }
  return rootPatch.value as JsonSchema;
}

function partitionGroups(
  groups: HistoryGroup[],
  selectedIndexes: Set<string>,
  select: boolean,
): HistoryGroup[] {
  return groups.flatMap((group) => {
    const selected: Array<{ patch: JsonPatch; patchIndex: number }> = [];
    group.patches.forEach((patch, offset) => {
      const patchIndex = group.patchIndexes[offset];
      if (patchIndex === undefined) {
        return;
      }
      const isSelected = selectedIndexes.has(
        effectKey({ historyIndex: group.historyIndex, patchIndex }),
      );
      if (isSelected === select) {
        selected.push({ patch, patchIndex });
      }
    });
    if (selected.length === 0) {
      return [];
    }
    return [
      {
        ...group,
        patches: selected.map(({ patch }) => structuredClone(patch)),
        patchIndexes: selected.map(({ patchIndex }) => patchIndex),
      },
    ];
  });
}

function effectKey({ historyIndex, patchIndex }: SchemaEffectRef): string {
  return `${historyIndex}:${patchIndex}`;
}

function blocker(
  code: SchemaProjectionBlocker['code'],
  message: string,
): SchemaProjectionBlocker {
  return { code, message };
}
