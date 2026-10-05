import { pluginRefs } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type {
  SchemaProjectionBlocker,
  SchemaProjectionBinding,
} from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import {
  foldHistoryGroups,
  partitionHistory,
  validateHistoryPrefix,
  validateSchemaHistory,
} from 'src/features/draft-changes/schema/schema-history';
import type {
  HistoryGroup,
  HistoryPartition,
} from 'src/features/draft-changes/schema/schema-history';
import { readSchemaStates } from 'src/features/draft-changes/schema/schema-snapshot';
import type { RevisionSchemaState } from 'src/features/draft-changes/schema/schema-snapshot';
import type { ViewsMigrationService } from 'src/features/share/views-migration.service';
import type { TableViewsData } from 'src/features/views/types';

export type StoredViewsSource =
  | { present: false }
  | { present: true; value: TableViewsData };

export interface SchemaViewBaselines {
  migratedHead: StoredViewsSource;
  head: StoredViewsSource;
  draft: StoredViewsSource;
}

export type SchemaViewBaselinesResult =
  | { status: 'projected'; baselines: SchemaViewBaselines }
  | { status: 'blocked'; blocker: SchemaProjectionBlocker };

export interface SchemaViewBaselinesInput {
  snapshot: DraftChangesSnapshot;
  tableCreatedId: string;
  operation: 'commit' | 'discard';
  binding?: SchemaProjectionBinding;
  headViews: StoredViewsSource;
  schemaRefs?: Record<string, JsonSchema>;
}

interface ViewMigrationFoldInput {
  views: StoredViewsSource;
  groups: HistoryGroup[];
  initialSchema: JsonSchema;
  refs: Record<string, JsonSchema>;
}

interface PreparedSchemaViewProgram {
  head: RevisionSchemaState;
  partitions: HistoryPartition;
}

export function projectSchemaViewBaselines(
  viewsMigrationService: ViewsMigrationService,
  input: SchemaViewBaselinesInput,
): SchemaViewBaselinesResult {
  const bindingBlocker = validateBinding(input);
  if (bindingBlocker) {
    return blocked(bindingBlocker);
  }

  const refs = {
    ...pluginRefs,
    ...(input.schemaRefs ?? {}),
  } as Record<string, JsonSchema>;
  const prepared = prepareSchemaViewProgram(input, refs);
  if ('blocker' in prepared) {
    return blocked(prepared.blocker);
  }
  const { head, partitions } = prepared.program;

  const migratedHead = migrateGroups(viewsMigrationService, {
    views: input.headViews,
    groups: partitions.all,
    initialSchema: head.schema,
    refs,
  });
  if ('blocker' in migratedHead) {
    return blocked(migratedHead.blocker);
  }

  const headGroups = input.operation === 'commit' ? partitions.selected : [];
  const draftGroups =
    input.operation === 'commit' ? partitions.all : partitions.remaining;
  const headBaseline = migrateGroups(viewsMigrationService, {
    views: input.headViews,
    groups: headGroups,
    initialSchema: head.schema,
    refs,
  });
  if ('blocker' in headBaseline) {
    return blocked(headBaseline.blocker);
  }

  const draftBaseline = migrateGroups(viewsMigrationService, {
    views: input.headViews,
    groups: draftGroups,
    initialSchema: head.schema,
    refs,
  });
  if ('blocker' in draftBaseline) {
    return blocked(draftBaseline.blocker);
  }

  return {
    status: 'projected',
    baselines: {
      migratedHead,
      head:
        input.operation === 'discard'
          ? cloneStoredViews(input.headViews)
          : headBaseline,
      draft: draftBaseline,
    },
  };
}

function prepareSchemaViewProgram(
  input: SchemaViewBaselinesInput,
  refs: Record<string, JsonSchema>,
):
  | { program: PreparedSchemaViewProgram }
  | { blocker: SchemaProjectionBlocker } {
  const sourceStates = readSchemaStates(input.snapshot, input.tableCreatedId);
  if ('blocker' in sourceStates) {
    return sourceStates;
  }

  const { head, draft } = sourceStates.state;
  const headHistoryBlocker = validateSchemaHistory(
    head.schema,
    head.history,
    refs,
  );
  if (headHistoryBlocker) {
    return { blocker: headHistoryBlocker };
  }

  const draftHistoryBlocker = validateSchemaHistory(
    draft.schema,
    draft.history,
    refs,
  );
  if (draftHistoryBlocker) {
    return { blocker: draftHistoryBlocker };
  }

  const prefixBlocker = validateHistoryPrefix(head.history, draft.history);
  if (prefixBlocker) {
    return { blocker: prefixBlocker };
  }

  const partitions = partitionHistory(
    draft.history,
    head.history.length,
    input.binding?.selectedEffects ?? [],
  );
  if ('code' in partitions) {
    return { blocker: partitions };
  }

  return { program: { head, partitions } };
}

function validateBinding(
  input: SchemaViewBaselinesInput,
): SchemaProjectionBlocker | undefined {
  const { binding } = input;
  if (!binding) {
    return undefined;
  }
  if (
    binding.sourceFingerprint !== input.snapshot.fingerprint ||
    binding.tableCreatedId !== input.tableCreatedId ||
    binding.operation !== input.operation ||
    binding.selectedEffects === undefined
  ) {
    return {
      code: 'SCHEMA_PROVENANCE_MISMATCH',
      message: 'Schema projection context does not match the original source.',
    };
  }
  return undefined;
}

function migrateGroups(
  viewsMigrationService: ViewsMigrationService,
  input: ViewMigrationFoldInput,
): StoredViewsSource | { blocker: SchemaProjectionBlocker } {
  const folded = foldHistoryGroups(
    input.initialSchema,
    input.groups,
    input.refs,
  );
  if ('blocker' in folded) {
    return { blocker: folded.blocker };
  }
  if (!input.views.present) {
    return { present: false };
  }

  let views = structuredClone(input.views.value);
  for (const { group, previousSchema } of folded.states) {
    views = viewsMigrationService.migrateViews({
      viewsData: views,
      patches: group.patches,
      previousSchema,
    });
  }
  return { present: true, value: views };
}

function cloneStoredViews(views: StoredViewsSource): StoredViewsSource {
  if (!views.present) {
    return { present: false };
  }
  return { present: true, value: structuredClone(views.value) };
}

function blocked(blocker: SchemaProjectionBlocker): SchemaViewBaselinesResult {
  return { status: 'blocked', blocker };
}
