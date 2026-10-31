import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
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

export function isStructureRecorded(
  headSchema: JsonSchema,
  pendingHistory: PendingSchemaHistory,
  draftSchema: JsonSchema,
  rules: NativeSchemaRules,
): boolean {
  if (!pendingHistory.extendsHead) {
    return false;
  }

  const replayed = replayPendingHistory(
    headSchema,
    pendingHistory.entries,
    rules,
  );

  return replayed !== undefined && schemasEqual(replayed, draftSchema);
}

function replayPendingHistory(
  headSchema: JsonSchema,
  entries: readonly HistoryPatches[],
  rules: NativeSchemaRules,
): JsonSchema | undefined {
  try {
    return entries.reduce(
      (schema, entry) => rules.patchedSchema(schema, entry.patches),
      headSchema,
    );
  } catch {
    return undefined;
  }
}
