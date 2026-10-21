import { pluginRefs, RevisiumValidator } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { foldSourceHistory } from 'src/features/draft-changes/schema/source-history/source-fold';
import { readSourceLedger } from 'src/features/draft-changes/schema/source-history/source-ledger';
import { reconcileWithDraft } from 'src/features/draft-changes/schema/source-history/source-reconciliation';
import type {
  SourceHistoryInput,
  SourceHistoryResult,
} from 'src/features/draft-changes/schema/source-history/source-history.types';

export function traceSourceHistory(
  input: SourceHistoryInput,
): SourceHistoryResult {
  const { head, draft } = input.snapshot;
  const validator = new RevisiumValidator();
  const ledger = readSourceLedger(head, draft, validator);
  if (ledger.status !== 'recorded') {
    return ledger;
  }

  const folded = foldSourceHistory(
    head,
    ledger.pendingMigrations,
    mergeSchemaRefs(input.schemaRefs),
    validator,
  );
  if ('blocker' in folded) {
    return { status: 'blocked', blocker: folded.blocker };
  }

  const reconciled = reconcileWithDraft(folded.state, draft, validator);
  if ('blocker' in reconciled) {
    return { status: 'blocked', blocker: reconciled.blocker };
  }

  return {
    status: 'traced',
    history: {
      pendingEvents: folded.state.events,
      tables: reconciled.tables,
    },
  };
}

function mergeSchemaRefs(
  schemaRefs: Record<string, JsonSchema> | undefined,
): Record<string, JsonSchema> {
  return { ...pluginRefs, ...(schemaRefs ?? {}) } as Record<string, JsonSchema>;
}
