import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { HistoryPatches } from 'src/features/share/queries/impl';

export type PendingSchemaHistory =
  | { readonly extendsHead: true; readonly entries: readonly HistoryPatches[] }
  | { readonly extendsHead: false };

export function pendingSchemaHistory(
  headHistory: readonly HistoryPatches[],
  draftHistory: readonly HistoryPatches[],
): PendingSchemaHistory {
  const headPrefix = draftHistory.slice(0, headHistory.length);

  if (!deepEqual(headPrefix, headHistory)) {
    return { extendsHead: false };
  }

  return { extendsHead: true, entries: draftHistory.slice(headHistory.length) };
}
