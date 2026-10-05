import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type {
  CandidateViewBlocker,
  ResolveCandidateViewsQueryData,
  ResolveCandidateViewsResult,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-views.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { ViewsMigrationService } from 'src/features/share/views-migration.service';
import type { ViewValidationService } from 'src/features/views/services/view-validation.service';
import { pairSnapshotTables } from 'src/features/draft-changes/catalogue/snapshot-pairs';
import { detachState } from 'src/features/draft-changes/candidates/candidate-state';
import { projectSchemaViewBaselines } from 'src/features/draft-changes/schema/schema-view-baselines';
import type { StoredViewsSource } from 'src/features/draft-changes/schema/schema-view-baselines';
import { buildStateViewEffects } from 'src/features/draft-changes/views/view-effects';
import { projectViewResidual } from 'src/features/draft-changes/views/view-residual';
import {
  readViewsForTable,
  writeViewsForTable,
} from 'src/features/draft-changes/views/view-state';
import { sourceStateForViewsWrite } from 'src/features/draft-changes/views/view-source';
import {
  projectionBindingForTable,
  shouldApplyViewEntry,
  selectedViewRefs,
  viewEntriesForTable,
} from 'src/features/draft-changes/views/view-selection';
import {
  projectOneSidedTableViews,
  projectStoredLifecycle,
  requiredDefaultEffects,
} from 'src/features/draft-changes/views/view-lifecycle';
import {
  validateStoredViewDocument,
  validateViewSchemaFields,
} from 'src/features/draft-changes/views/view-validation';
import {
  readValidatedViewsSource,
  validatedViewsSourceBlocker,
} from 'src/features/draft-changes/views/view-source';

type SelectedInput = Extract<
  ResolveCandidateViewsQueryData,
  { mode: 'selected' }
>;
type RestoreInput = Extract<
  ResolveCandidateViewsQueryData,
  { mode: 'restoreHead' }
>;

interface ProjectionContext {
  head: DraftRevisionState;
  draft: DraftRevisionState;
}

export async function resolveCandidateViewState(
  data: ResolveCandidateViewsQueryData,
  viewsMigrationService: ViewsMigrationService,
  validation: ViewValidationService,
): Promise<ResolveCandidateViewsResult> {
  if (data.mode === 'restoreHead') {
    return restoreHeadViews(data, validation);
  }
  return resolveSelectedViews(data, viewsMigrationService, validation);
}

async function restoreHeadViews(
  data: RestoreInput,
  validation: ViewValidationService,
): Promise<ResolveCandidateViewsResult> {
  const states = {
    head: detachState(data.head),
    draft: detachState(data.draft),
  };
  for (const table of data.snapshot.head.tables.filter(
    ({ system }) => !system,
  )) {
    const source = await readValidatedViewsSource(
      data.snapshot.head,
      table.createdId,
      table.id,
      validation,
    );
    if (source.status === 'blocked') {
      return blocked(validatedViewsSourceBlocker(source, table.createdId));
    }
    const document = source.source;
    for (const role of ['head', 'draft'] as const) {
      const targetState = states[role];
      const sourceState = data.snapshot.head;
      const written = writeViewsForTable(
        targetState,
        sourceState,
        table.createdId,
        document,
      );
      if (!written && document.present) {
        return blocked(missingViewsRow(table.createdId));
      }
    }
  }
  const validationBlocker =
    (await validateRoleViews(states.head, 'head', validation)) ??
    (await validateRoleViews(states.draft, 'draft', validation));
  if (validationBlocker) {
    return blocked(validationBlocker);
  }
  return {
    status: 'projected',
    ...states,
    effects: buildStateViewEffects(
      { head: data.head, draft: data.draft },
      states,
    ),
  };
}

async function resolveSelectedViews(
  data: SelectedInput,
  viewsMigrationService: ViewsMigrationService,
  validation: ViewValidationService,
): Promise<ResolveCandidateViewsResult> {
  const scopeBlocker = validateCatalogueScope(data);
  if (scopeBlocker) {
    return blocked(scopeBlocker);
  }
  const selectedRefs = selectedViewRefs(data.selection, data.effectiveRefs);
  const selectionBlocker = validateEffectiveRefs(data, selectedRefs);
  if (selectionBlocker) {
    return blocked(selectionBlocker);
  }
  const required = requiredDefaultEffects(data, selectedRefs);
  if (required) {
    return required;
  }

  const states: ProjectionContext = {
    head: detachState(data.head),
    draft: detachState(data.draft),
  };
  const paired = pairSnapshotTables(data.snapshot);
  if ('blocker' in paired) {
    return blocked({
      code: 'INVALID_SELECTION',
      message: paired.blocker,
    });
  }

  for (const pair of paired.pairs) {
    const result = await projectTableViews(
      data,
      pair.createdId,
      pair.head,
      pair.draft,
      states,
      selectedRefs,
      viewsMigrationService,
      validation,
    );
    if (result.status !== 'projected') {
      return result;
    }
  }

  const validationBlocker =
    (await validateRoleViews(states.head, 'head', validation)) ??
    (await validateRoleViews(states.draft, 'draft', validation));
  if (validationBlocker) {
    return blocked(validationBlocker);
  }
  const effects = buildStateViewEffects(
    { head: data.head, draft: data.draft },
    states,
  );
  return { status: 'projected', ...states, effects };
}

async function projectTableViews(
  data: SelectedInput,
  tableCreatedId: string,
  headTable: DraftChangesSnapshot['head']['tables'][number] | undefined,
  draftTable: DraftChangesSnapshot['draft']['tables'][number] | undefined,
  states: ProjectionContext,
  selectedRefs: Set<string>,
  viewsMigrationService: ViewsMigrationService,
  validation: ViewValidationService,
): Promise<ResolveCandidateViewsResult> {
  const [headSource, draftSource] = await Promise.all([
    headTable
      ? readValidatedViewsSource(
          data.snapshot.head,
          tableCreatedId,
          headTable.id,
          validation,
        )
      : Promise.resolve({
          status: 'loaded' as const,
          source: { present: false } as const,
        }),
    draftTable
      ? readValidatedViewsSource(
          data.snapshot.draft,
          tableCreatedId,
          draftTable.id,
          validation,
        )
      : Promise.resolve({
          status: 'loaded' as const,
          source: { present: false } as const,
        }),
  ]);
  if (headSource.status === 'blocked') {
    return blocked(validatedViewsSourceBlocker(headSource, tableCreatedId));
  }
  if (draftSource.status === 'blocked') {
    return blocked(validatedViewsSourceBlocker(draftSource, tableCreatedId));
  }

  if (headTable && draftTable) {
    return projectSharedTableViews(
      data,
      tableCreatedId,
      headSource.source,
      draftSource.source,
      states,
      selectedRefs,
      viewsMigrationService,
    );
  }
  return projectOneSidedTableViews(
    data,
    tableCreatedId,
    headTable,
    draftTable,
    headSource.source,
    draftSource.source,
    states,
    selectedRefs,
  );
}

function projectSharedTableViews(
  data: SelectedInput,
  tableCreatedId: string,
  headViews: StoredViewsSource,
  draftViews: StoredViewsSource,
  states: ProjectionContext,
  selectedRefs: Set<string>,
  viewsMigrationService: ViewsMigrationService,
): ResolveCandidateViewsResult {
  const context = resolveSchemaViewProjection(
    data,
    tableCreatedId,
    headViews,
    selectedRefs,
    viewsMigrationService,
  );
  if (context.status === 'blocked') {
    return blocked(context.blocker);
  }
  const { binding, baselines } = context;

  const migrated = baselines.baselines.migratedHead;
  const entries = viewEntriesForTable(data.catalogue.entries, tableCreatedId);
  const targetRole = data.operation === 'commit' ? 'head' : 'draft';
  const baseline =
    data.operation === 'commit'
      ? baselines.baselines.head
      : baselines.baselines.draft;
  if (migrated.present && draftViews.present && baseline.present) {
    const applicableEntries = entries.filter((entry) =>
      shouldApplyViewEntry(
        entry,
        data.operation,
        targetRole,
        selectedRefs,
        data.selection,
      ),
    );
    const projection = projectViewResidual({
      baseline: baseline.value,
      migrated: migrated.value,
      draft: draftViews.value,
      entries: applicableEntries,
      binding,
      tableCreatedId,
    });
    if (projection.status === 'blocked') {
      return { status: 'blocked', blockers: [projection.blocker] };
    }
    const destination = targetRole === 'head' ? states.head : states.draft;
    const source = sourceStateForViewsWrite(
      data.snapshot.head,
      data.snapshot.draft,
      tableCreatedId,
      targetRole,
    );
    if (
      !writeViewsForTable(destination, source, tableCreatedId, {
        present: true,
        value: projection.value,
      })
    ) {
      return blocked(missingViewsRow(tableCreatedId));
    }
  }

  if (!baseline.present && !migrated.present && !draftViews.present) {
    return {
      status: 'projected',
      head: states.head,
      draft: states.draft,
      effects: [],
    };
  }
  if (
    migrated.present !== draftViews.present ||
    baseline.present !== migrated.present
  ) {
    return projectStoredLifecycle(
      data,
      tableCreatedId,
      baseline,
      draftViews,
      entries,
      states,
      selectedRefs,
    );
  }
  return {
    status: 'projected',
    head: states.head,
    draft: states.draft,
    effects: [],
  };
}

function resolveSchemaViewProjection(
  data: SelectedInput,
  tableCreatedId: string,
  headViews: StoredViewsSource,
  selectedRefs: Set<string>,
  viewsMigrationService: ViewsMigrationService,
):
  | {
      status: 'projected';
      binding: ReturnType<typeof projectionBindingForTable>;
      baselines: ReturnType<typeof projectSchemaViewBaselines> & {
        status: 'projected';
      };
    }
  | { status: 'blocked'; blocker: CandidateViewBlocker } {
  const binding = projectionBindingForTable(
    data.schemaProjectionBindings,
    tableCreatedId,
  );
  const hasSelectedSchemaEntries = data.catalogue.entries.some(
    (entry) =>
      entry.target.kind === 'schemaField' &&
      entry.target.tableCreatedId === tableCreatedId &&
      selectedRefs.has(entry.ref.value),
  );
  if (hasSelectedSchemaEntries && !binding) {
    return {
      status: 'blocked',
      blocker: {
        code: 'SCHEMA_PROJECTION_BLOCKED',
        message: `The selected schema changes for table '${tableCreatedId}' have no successful projection context.`,
        tableCreatedId,
      },
    };
  }
  const baselines = projectSchemaViewBaselines(viewsMigrationService, {
    snapshot: data.snapshot,
    tableCreatedId,
    operation: data.operation,
    binding,
    headViews,
  });
  if (baselines.status === 'blocked') {
    return {
      status: 'blocked',
      blocker: {
        code: 'SCHEMA_PROJECTION_BLOCKED',
        message: baselines.blocker.message,
        tableCreatedId,
      },
    };
  }
  return { status: 'projected', binding, baselines };
}

async function validateRoleViews(
  state: DraftRevisionState,
  role: 'head' | 'draft',
  validation: ViewValidationService,
): Promise<CandidateViewBlocker | undefined> {
  for (const table of state.tables.filter(({ system }) => !system)) {
    const source = readViewsForTable(state, table.createdId);
    if (source.status === 'missing' || source.status === 'missingTable') {
      continue;
    }
    const normalized = await validateStoredViewDocument(
      validation,
      table.createdId,
      table.id,
      source.value,
    );
    if (normalized.status === 'blocked') {
      return normalized.blocker;
    }
    const fieldBlocker = validateViewSchemaFields(
      validation,
      role,
      state,
      table.createdId,
      table.id,
      normalized.document,
    );
    if (fieldBlocker) {
      return fieldBlocker;
    }
  }
  return undefined;
}

function validateCatalogueScope(
  data: SelectedInput,
): CandidateViewBlocker | undefined {
  const { scope } = data.catalogue;
  if (
    scope.fingerprint !== data.snapshot.fingerprint ||
    scope.branchId !== data.snapshot.branch.id ||
    scope.headRevisionId !== data.snapshot.head.id ||
    scope.draftRevisionId !== data.snapshot.draft.id
  ) {
    return {
      code: 'SCOPE_MISMATCH',
      message:
        'The view catalogue does not belong to the supplied source snapshot.',
    };
  }
  return undefined;
}

function validateEffectiveRefs(
  data: SelectedInput,
  refs: Set<string>,
): CandidateViewBlocker | undefined {
  const known = new Set(data.catalogue.entries.map(({ ref }) => ref.value));
  const requested = new Set([
    ...refs,
    ...data.selection.selected.map(({ ref }) => ref.value),
  ]);
  const unknown = [...requested].find((ref) => !known.has(ref));
  return unknown
    ? {
        code: 'INVALID_SELECTION',
        message: `The effective selection contains unknown change reference '${unknown}'.`,
      }
    : undefined;
}

function blocked(blocker: CandidateViewBlocker): ResolveCandidateViewsResult {
  return { status: 'blocked', blockers: [blocker] };
}

function missingViewsRow(tableCreatedId: string): CandidateViewBlocker {
  return {
    code: 'INVALID_VIEW_DATA',
    message: `The native views row for table '${tableCreatedId}' cannot be materialized from the supplied source states.`,
    tableCreatedId,
  };
}
