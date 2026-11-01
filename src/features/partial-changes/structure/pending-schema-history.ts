import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { PendingSchemaHistory } from 'src/features/share/ledger/schema-history';
import type { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import type { HistoryPatches } from 'src/features/share/queries/impl';

export function hasPendingEntries(
  pendingHistory: PendingSchemaHistory,
): boolean {
  return !pendingHistory.extendsHead || pendingHistory.entries.length > 0;
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
