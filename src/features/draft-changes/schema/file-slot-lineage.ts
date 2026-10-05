import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { HistoryGroup } from 'src/features/draft-changes/schema/schema-history';
import type { SchemaFileSlotProjectionBinding } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import {
  escapePointer,
  unescapePointer,
} from 'src/features/draft-changes/schema/json-value-path';

export function projectFileSlots(
  all: HistoryGroup[],
  active: HistoryGroup[],
  role: 'head' | 'draft',
): SchemaFileSlotProjectionBinding[] {
  const output: SchemaFileSlotProjectionBinding[] = [];
  for (const group of active) {
    for (let index = 0; index < group.patches.length; index += 1) {
      const patch = group.patches[index];
      const patchIndex = group.patchIndexes[index];
      if (
        !patch ||
        patchIndex === undefined ||
        patch.op !== 'add' ||
        !isFileSchema(patch.value)
      ) {
        continue;
      }
      const sourcePath = trackSlot(
        all,
        group.historyIndex,
        patchIndex,
        patch.path,
      );
      const projectedPath = trackSlot(
        active,
        group.historyIndex,
        patchIndex,
        patch.path,
      );
      if (!sourcePath || !projectedPath) {
        continue;
      }
      output.push({
        role,
        introducedBy: { historyIndex: group.historyIndex, patchIndex },
        sourceDraftPath: schemaPathToDataPath(sourcePath),
        projectedPath: schemaPathToDataPath(projectedPath),
      });
    }
  }
  return output;
}

function trackSlot(
  groups: HistoryGroup[],
  historyIndex: number,
  patchIndex: number,
  originalPath: string,
): string | undefined {
  let path = originalPath;
  let started = false;
  for (const entry of flattenPatches(groups)) {
    if (
      !started &&
      isStartingPatch(
        entry.historyIndex,
        entry.patchIndex,
        historyIndex,
        patchIndex,
      )
    ) {
      started = true;
      continue;
    }
    if (!started) {
      continue;
    }
    const updatedPath = applyPathPatch(path, entry.patch);
    if (updatedPath === null) {
      return undefined;
    }
    path = updatedPath;
  }
  return started ? path : undefined;
}

function flattenPatches(groups: HistoryGroup[]): Array<{
  historyIndex: number;
  patchIndex: number;
  patch: HistoryGroup['patches'][number];
}> {
  const entries: Array<{
    historyIndex: number;
    patchIndex: number;
    patch: HistoryGroup['patches'][number];
  }> = [];
  for (const group of groups) {
    for (let offset = 0; offset < group.patches.length; offset += 1) {
      const patch = group.patches[offset];
      const patchIndex = group.patchIndexes[offset];
      if (patch && patchIndex !== undefined) {
        entries.push({ historyIndex: group.historyIndex, patchIndex, patch });
      }
    }
  }
  return entries;
}

function isStartingPatch(
  currentHistory: number,
  currentIndex: number,
  targetHistory: number,
  targetIndex: number,
): boolean {
  return currentHistory === targetHistory && currentIndex === targetIndex;
}

function applyPathPatch(
  path: string,
  patch: HistoryGroup['patches'][number],
): string | null {
  if (patch.op === 'move' && isSameOrChildPath(path, patch.from)) {
    return `${patch.path}${path.slice(patch.from.length)}`;
  }
  if (
    (patch.op === 'remove' || patch.op === 'replace') &&
    isSameOrChildPath(path, patch.path)
  ) {
    return null;
  }
  return path;
}

function isSameOrChildPath(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

function isFileSchema(schema: unknown): schema is JsonSchema {
  return (
    schema !== null &&
    typeof schema === 'object' &&
    '$ref' in schema &&
    schema.$ref === SystemSchemaIds.File
  );
}

function schemaPathToDataPath(path: string): string {
  const segments = path.split('/').slice(1).map(unescapePointer);
  const data: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const property = segments[i + 1];
    if (segment === 'properties' && property !== undefined) {
      data.push(property);
      i += 1;
    } else if (segment === 'items') {
      return '';
    }
  }
  return data.length ? `/${data.map(escapePointer).join('/')}` : '';
}
