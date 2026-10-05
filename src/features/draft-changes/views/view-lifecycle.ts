import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type {
  CandidateViewBlocker,
  ResolveCandidateViewsQueryData,
  ResolveCandidateViewsResult,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-views.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { StoredViewsSource } from 'src/features/draft-changes/schema/schema-view-baselines';
import { findTable } from 'src/features/draft-changes/candidates/candidate-state';
import {
  isDeniedTableLifecycleEntry,
  isDeniedViewEntry,
  shouldApplyViewEntry,
  viewEntriesForTable,
} from 'src/features/draft-changes/views/view-selection';
import {
  isTableViewsData,
  readViewsForTable,
  writeViewsForTable,
} from 'src/features/draft-changes/views/view-state';
import { sourceStateForViewsWrite } from 'src/features/draft-changes/views/view-source';
import type { TableViewsData } from 'src/features/views/types';
import { projectViewConfiguration } from 'src/features/draft-changes/views/view-configuration';

type SelectedInput = Extract<
  ResolveCandidateViewsQueryData,
  { mode: 'selected' }
>;

interface ProjectionContext {
  head: DraftRevisionState;
  draft: DraftRevisionState;
}

export function projectOneSidedTableViews(
  data: SelectedInput,
  tableCreatedId: string,
  headTable: DraftChangesSnapshot['head']['tables'][number] | undefined,
  draftTable: DraftChangesSnapshot['draft']['tables'][number] | undefined,
  headViews: StoredViewsSource,
  draftViews: StoredViewsSource,
  states: ProjectionContext,
  selectedRefs: Set<string>,
): ResolveCandidateViewsResult {
  const entries = viewEntriesForTable(data.catalogue.entries, tableCreatedId);
  const createdTableResult = projectCreatedTableViews(
    data,
    tableCreatedId,
    headTable,
    draftTable,
    draftViews,
    entries,
    states,
    selectedRefs,
  );
  if (createdTableResult) {
    return createdTableResult;
  }
  const deletedTableResult = projectDeletedTableViews(
    data,
    tableCreatedId,
    headTable,
    draftTable,
    headViews,
    entries,
    states,
    selectedRefs,
  );
  if (deletedTableResult) {
    return deletedTableResult;
  }
  removeMissingTableViewDocuments(data, tableCreatedId, states);
  return {
    status: 'projected',
    head: states.head,
    draft: states.draft,
    effects: [],
  };
}

function projectCreatedTableViews(
  data: SelectedInput,
  tableCreatedId: string,
  headTable: DraftChangesSnapshot['head']['tables'][number] | undefined,
  draftTable: DraftChangesSnapshot['draft']['tables'][number] | undefined,
  draftViews: StoredViewsSource,
  entries: DraftChangesCatalogueEntry[],
  states: ProjectionContext,
  selectedRefs: Set<string>,
): ResolveCandidateViewsResult | undefined {
  if (
    headTable ||
    !draftTable ||
    data.operation !== 'commit' ||
    !draftViews.present ||
    !entries.some((entry) =>
      shouldApplyViewEntry(
        entry,
        'commit',
        'head',
        selectedRefs,
        data.selection,
      ),
    )
  ) {
    return undefined;
  }
  if (findTable(states.head, tableCreatedId)) {
    return projectStoredLifecycle(
      data,
      tableCreatedId,
      { present: false },
      draftViews,
      entries,
      states,
      selectedRefs,
    );
  }
  return requireTableCreationForView(
    data,
    tableCreatedId,
    entries,
    selectedRefs,
  );
}

function requireTableCreationForView(
  data: SelectedInput,
  tableCreatedId: string,
  entries: DraftChangesCatalogueEntry[],
  selectedRefs: Set<string>,
): ResolveCandidateViewsResult {
  const tableEntry = data.catalogue.entries.find(
    ({ target }) =>
      target.kind === 'table' && target.tableCreatedId === tableCreatedId,
  );
  const cause = entries.find((entry) =>
    shouldApplyViewEntry(entry, 'commit', 'head', selectedRefs, data.selection),
  );
  if (!tableEntry || !cause) {
    return blocked({
      code: 'INVALID_SELECTION',
      message: `The view change for table '${tableCreatedId}' has no valid parent effect.`,
      tableCreatedId,
    });
  }
  if (isDeniedTableLifecycleEntry(tableEntry, data.selection)) {
    return blocked({
      code: 'EXCLUDED_PREREQUISITE',
      message: `A hard exclusion prevents creating table '${tableCreatedId}' for its selected view change.`,
      tableCreatedId,
    });
  }
  return {
    status: 'needsEffects',
    requirements: [
      { role: 'head', causeRef: cause.ref, refs: [tableEntry.ref] },
    ],
  };
}

function projectDeletedTableViews(
  data: SelectedInput,
  tableCreatedId: string,
  headTable: DraftChangesSnapshot['head']['tables'][number] | undefined,
  draftTable: DraftChangesSnapshot['draft']['tables'][number] | undefined,
  headViews: StoredViewsSource,
  entries: DraftChangesCatalogueEntry[],
  states: ProjectionContext,
  selectedRefs: Set<string>,
): ResolveCandidateViewsResult | undefined {
  if (
    !headTable ||
    draftTable ||
    data.operation !== 'discard' ||
    !headViews.present ||
    !findTable(states.draft, tableCreatedId)
  ) {
    return undefined;
  }
  return projectStoredLifecycle(
    data,
    tableCreatedId,
    headViews,
    { present: false },
    entries,
    states,
    selectedRefs,
  );
}

function removeMissingTableViewDocuments(
  data: SelectedInput,
  tableCreatedId: string,
  states: ProjectionContext,
): void {
  for (const role of ['head', 'draft'] as const) {
    const destination = role === 'head' ? states.head : states.draft;
    if (findTable(destination, tableCreatedId)) {
      continue;
    }
    writeViewsForTable(
      destination,
      sourceStateForViewsWrite(
        data.snapshot.head,
        data.snapshot.draft,
        tableCreatedId,
        role,
      ),
      tableCreatedId,
      { present: false },
    );
  }
}

export function projectStoredLifecycle(
  data: SelectedInput,
  tableCreatedId: string,
  baseline: StoredViewsSource,
  draft: StoredViewsSource,
  entries: DraftChangesCatalogueEntry[],
  states: ProjectionContext,
  selectedRefs: Set<string>,
): ResolveCandidateViewsResult {
  const targetRole = data.operation === 'commit' ? 'head' : 'draft';
  const destination = targetRole === 'head' ? states.head : states.draft;
  const current = draft.present ? draft.value : undefined;
  const lifecycleEntries = entries.filter(
    (entry) =>
      entry.target.kind === 'view' && entry.target.component === 'lifecycle',
  );
  const activeConfigurationEntries = entries.filter(
    (entry) =>
      entry.target.kind === 'viewConfiguration' &&
      shouldApplyViewEntry(
        entry,
        data.operation,
        targetRole,
        selectedRefs,
        data.selection,
      ),
  );
  const result = projectLifecycleDocument(
    baseline,
    current,
    lifecycleEntries,
    activeConfigurationEntries,
    data,
    targetRole,
    selectedRefs,
  );
  const prerequisite = requiredDocumentPrerequisite(
    result,
    baseline,
    current,
    entries,
    lifecycleEntries,
    activeConfigurationEntries,
    data,
    targetRole,
    selectedRefs,
  );
  if (prerequisite) {
    return prerequisite;
  }
  const source = sourceStateForViewsWrite(
    data.snapshot.head,
    data.snapshot.draft,
    tableCreatedId,
    targetRole,
  );
  if (!writeLifecycleDocument(destination, source, tableCreatedId, result)) {
    return blocked(missingViewsRow(tableCreatedId));
  }
  return {
    status: 'projected',
    head: states.head,
    draft: states.draft,
    effects: [],
  };
}

function projectLifecycleDocument(
  baseline: StoredViewsSource,
  current: TableViewsData | undefined,
  lifecycleEntries: DraftChangesCatalogueEntry[],
  configurationEntries: DraftChangesCatalogueEntry[],
  data: SelectedInput,
  targetRole: 'head' | 'draft',
  selectedRefs: Set<string>,
): TableViewsData | undefined {
  let result = baseline.present ? structuredClone(baseline.value) : undefined;
  const currentById = new Map(
    (current?.views ?? []).map((view) => [view.id, view]),
  );
  for (const entry of lifecycleEntries) {
    result = applyLifecycleEntry(
      entry,
      currentById,
      result,
      data,
      targetRole,
      selectedRefs,
    );
  }
  if (!baseline.present && !result && configurationEntries.length > 0) {
    result = { views: [] } as unknown as TableViewsData;
  }
  if (result && current) {
    return projectViewConfiguration(result, current, configurationEntries);
  }
  return result;
}

function applyLifecycleEntry(
  entry: DraftChangesCatalogueEntry,
  currentById: Map<string, TableViewsData['views'][number]>,
  result: TableViewsData | undefined,
  data: SelectedInput,
  targetRole: 'head' | 'draft',
  selectedRefs: Set<string>,
): TableViewsData | undefined {
  if (
    entry.target.kind !== 'view' ||
    !shouldApplyViewEntry(
      entry,
      data.operation,
      targetRole,
      selectedRefs,
      data.selection,
    )
  ) {
    return result;
  }
  const target = entry.target;
  const view = currentById.get(target.viewId);
  if (view) {
    const next = result ?? ({ views: [] } as unknown as TableViewsData);
    if (!next.views.some(({ id }) => id === target.viewId)) {
      next.views.push(structuredClone(view));
    }
    return next;
  }
  if (result) {
    result.views = result.views.filter(({ id }) => id !== target.viewId);
  }
  return result;
}

function requiredDocumentPrerequisite(
  result: TableViewsData | undefined,
  baseline: StoredViewsSource,
  current: TableViewsData | undefined,
  entries: DraftChangesCatalogueEntry[],
  lifecycleEntries: DraftChangesCatalogueEntry[],
  configurationEntries: DraftChangesCatalogueEntry[],
  data: SelectedInput,
  targetRole: 'head' | 'draft',
  selectedRefs: Set<string>,
): ResolveCandidateViewsResult | undefined {
  if (baseline.present || !result) {
    return undefined;
  }
  const prerequisites = requiredDocumentEntries(
    result,
    current,
    entries,
    lifecycleEntries,
    configurationEntries,
  );
  return missingDocumentEffects(
    prerequisites,
    lifecycleEntries,
    configurationEntries,
    data,
    targetRole,
    selectedRefs,
  );
}

function missingDocumentEffects(
  prerequisites: DraftChangesCatalogueEntry[],
  lifecycleEntries: DraftChangesCatalogueEntry[],
  configurationEntries: DraftChangesCatalogueEntry[],
  data: SelectedInput,
  targetRole: 'head' | 'draft',
  selectedRefs: Set<string>,
): ResolveCandidateViewsResult | undefined {
  const missing = prerequisites.filter(
    (entry) =>
      !shouldApplyViewEntry(
        entry,
        data.operation,
        targetRole,
        selectedRefs,
        data.selection,
      ),
  );
  const denied = missing.find((entry) =>
    isDeniedViewEntry(entry, data.selection),
  );
  if (denied) {
    return blocked({
      code: 'EXCLUDED_PREREQUISITE',
      message: 'A hard exclusion prevents materializing the view document.',
      tableCreatedId: denied.target.tableCreatedId,
    });
  }
  const cause = findAppliedDocumentCause(
    lifecycleEntries,
    configurationEntries,
    data,
    targetRole,
    selectedRefs,
  );
  const refs = missing.map(({ ref }) => ref);
  return cause && refs.length > 0
    ? {
        status: 'needsEffects',
        requirements: [{ role: targetRole, causeRef: cause.ref, refs }],
      }
    : undefined;
}

function findAppliedDocumentCause(
  lifecycleEntries: DraftChangesCatalogueEntry[],
  configurationEntries: DraftChangesCatalogueEntry[],
  data: SelectedInput,
  targetRole: 'head' | 'draft',
  selectedRefs: Set<string>,
): DraftChangesCatalogueEntry | undefined {
  return (
    lifecycleEntries.find((entry) =>
      shouldApplyViewEntry(
        entry,
        data.operation,
        targetRole,
        selectedRefs,
        data.selection,
      ),
    ) ?? configurationEntries[0]
  );
}

function writeLifecycleDocument(
  destination: DraftRevisionState,
  source: DraftRevisionState,
  tableCreatedId: string,
  document: TableViewsData | undefined,
): boolean {
  return writeViewsForTable(
    destination,
    source,
    tableCreatedId,
    document ? { present: true, value: document } : { present: false },
  );
}

function requiredDocumentEntries(
  result: TableViewsData,
  current: TableViewsData | undefined,
  entries: DraftChangesCatalogueEntry[],
  lifecycleEntries: DraftChangesCatalogueEntry[],
  activeConfigurationEntries: DraftChangesCatalogueEntry[],
): DraftChangesCatalogueEntry[] {
  const required = new Map<string, DraftChangesCatalogueEntry>();
  const requireConfiguration = (
    component: 'version' | 'defaultViewId' | 'order',
  ): void => {
    const entry = entries.find(
      (candidate) =>
        candidate.target.kind === 'viewConfiguration' &&
        candidate.target.component === component,
    );
    if (entry && !Object.prototype.hasOwnProperty.call(result, component)) {
      required.set(entry.ref.value, entry);
    }
  };

  requireConfiguration('version');
  requireConfiguration('defaultViewId');
  const neededViewIds = new Set<string>();
  const defaultViewId =
    typeof result.defaultViewId === 'string'
      ? result.defaultViewId
      : current?.defaultViewId;
  if (defaultViewId) {
    neededViewIds.add(defaultViewId);
  }
  const orderSelected = activeConfigurationEntries.some(
    ({ target }) =>
      target.kind === 'viewConfiguration' && target.component === 'order',
  );
  if (orderSelected) {
    for (const { id } of current?.views ?? []) {
      neededViewIds.add(id);
    }
  }

  for (const viewId of neededViewIds) {
    if (result.views.some(({ id }) => id === viewId)) {
      continue;
    }
    const entry = lifecycleEntries.find(
      (candidate) =>
        candidate.target.kind === 'view' && candidate.target.viewId === viewId,
    );
    if (entry) {
      required.set(entry.ref.value, entry);
    }
  }
  return [...required.values()];
}

export function requiredDefaultEffects(
  data: SelectedInput,
  selectedRefs: Set<string>,
): ResolveCandidateViewsResult | undefined {
  const entries = data.catalogue.entries;
  const commitPrerequisite = requiredCommitDefaultPrerequisite(
    data,
    selectedRefs,
    entries,
  );
  if (commitPrerequisite) {
    return commitPrerequisite;
  }
  return requiredDiscardDefaultPrerequisite(data, selectedRefs, entries);
}

function requiredCommitDefaultPrerequisite(
  data: SelectedInput,
  selectedRefs: Set<string>,
  entries: DraftChangesCatalogueEntry[],
): ResolveCandidateViewsResult | undefined {
  if (data.operation !== 'commit') {
    return undefined;
  }
  return (
    requiredNewDefaultCreation(data, selectedRefs, entries) ??
    requiredDefaultDeletionReplacement(data, selectedRefs, entries)
  );
}

function requiredNewDefaultCreation(
  data: SelectedInput,
  selectedRefs: Set<string>,
  entries: DraftChangesCatalogueEntry[],
): ResolveCandidateViewsResult | undefined {
  const defaultChanges = entries.filter(
    (entry) =>
      entry.target.kind === 'viewConfiguration' &&
      entry.target.component === 'defaultViewId' &&
      shouldApplyViewEntry(
        entry,
        'commit',
        'head',
        selectedRefs,
        data.selection,
      ),
  );
  for (const defaultChange of defaultChanges) {
    const targetViewId = defaultChange.after;
    if (typeof targetViewId !== 'string') {
      continue;
    }
    const creation = entries.find(
      (entry) =>
        entry.target.kind === 'view' &&
        entry.target.component === 'lifecycle' &&
        entry.target.tableCreatedId === defaultChange.target.tableCreatedId &&
        entry.target.viewId === targetViewId &&
        entry.classification === 'created',
    );
    if (
      creation &&
      !shouldApplyViewEntry(
        creation,
        'commit',
        'head',
        selectedRefs,
        data.selection,
      )
    ) {
      return requiredDefaultPrerequisite(data, creation, defaultChange, 'head');
    }
  }
  return undefined;
}

function requiredDefaultDeletionReplacement(
  data: SelectedInput,
  selectedRefs: Set<string>,
  entries: DraftChangesCatalogueEntry[],
): ResolveCandidateViewsResult | undefined {
  for (const deletion of entries) {
    if (deletion.target.kind !== 'view') {
      continue;
    }
    const target = deletion.target;
    if (
      target.component !== 'lifecycle' ||
      deletion.classification !== 'deleted' ||
      !shouldApplyViewEntry(
        deletion,
        'commit',
        'head',
        selectedRefs,
        data.selection,
      )
    ) {
      continue;
    }
    const replacement = defaultReplacementForDeletedView(data, target, entries);
    if (
      replacement &&
      !shouldApplyViewEntry(
        replacement,
        'commit',
        'head',
        selectedRefs,
        data.selection,
      )
    ) {
      return requiredDefaultPrerequisite(data, replacement, deletion, 'head');
    }
  }
  return undefined;
}

function defaultReplacementForDeletedView(
  data: SelectedInput,
  target: Extract<DraftChangesCatalogueEntry['target'], { kind: 'view' }>,
  entries: DraftChangesCatalogueEntry[],
): DraftChangesCatalogueEntry | undefined {
  const source = readViewsForTable(data.snapshot.head, target.tableCreatedId);
  if (source.status !== 'present' || !isTableViewsData(source.value)) {
    return undefined;
  }
  const sourceView = source.value.views.find(({ id }) => id === target.viewId);
  if (!sourceView || source.value.defaultViewId !== sourceView.id) {
    return undefined;
  }
  return entries.find(
    (entry) =>
      entry.target.kind === 'viewConfiguration' &&
      entry.target.tableCreatedId === target.tableCreatedId &&
      entry.target.component === 'defaultViewId',
  );
}

function requiredDiscardDefaultPrerequisite(
  data: SelectedInput,
  selectedRefs: Set<string>,
  entries: DraftChangesCatalogueEntry[],
): ResolveCandidateViewsResult | undefined {
  if (data.operation !== 'discard') {
    return undefined;
  }
  const selectedCreations = entries.filter(
    (entry) =>
      entry.target.kind === 'view' &&
      entry.target.component === 'lifecycle' &&
      entry.classification === 'created' &&
      !shouldApplyViewEntry(
        entry,
        'discard',
        'draft',
        selectedRefs,
        data.selection,
      ),
  );
  for (const creation of selectedCreations) {
    if (creation.target.kind !== 'view') {
      continue;
    }
    const target = creation.target;
    const defaultChange = entries.find(
      (entry) =>
        entry.target.kind === 'viewConfiguration' &&
        entry.target.tableCreatedId === target.tableCreatedId &&
        entry.target.component === 'defaultViewId' &&
        entry.after === target.viewId &&
        shouldApplyViewEntry(
          entry,
          'discard',
          'draft',
          selectedRefs,
          data.selection,
        ),
    );
    if (defaultChange) {
      return requiredDefaultPrerequisite(
        data,
        defaultChange,
        creation,
        'draft',
      );
    }
  }
  return requiredDiscardedDefaultMembership(data, selectedRefs, entries);
}

function requiredDiscardedDefaultMembership(
  data: SelectedInput,
  selectedRefs: Set<string>,
  entries: DraftChangesCatalogueEntry[],
): ResolveCandidateViewsResult | undefined {
  const discardedDefaults = entries.filter(
    (entry) =>
      entry.target.kind === 'viewConfiguration' &&
      entry.target.component === 'defaultViewId' &&
      !shouldApplyViewEntry(
        entry,
        'discard',
        'draft',
        selectedRefs,
        data.selection,
      ),
  );
  for (const defaultChange of discardedDefaults) {
    if (typeof defaultChange.before !== 'string') {
      continue;
    }
    const deletion = entries.find(
      (entry) =>
        entry.target.kind === 'view' &&
        entry.target.component === 'lifecycle' &&
        entry.target.tableCreatedId === defaultChange.target.tableCreatedId &&
        entry.target.viewId === defaultChange.before &&
        entry.classification === 'deleted',
    );
    if (
      deletion &&
      shouldApplyViewEntry(
        deletion,
        'discard',
        'draft',
        selectedRefs,
        data.selection,
      )
    ) {
      return requiredDefaultPrerequisite(
        data,
        deletion,
        defaultChange,
        'draft',
      );
    }
  }
  return undefined;
}

function requiredDefaultPrerequisite(
  data: SelectedInput,
  required: DraftChangesCatalogueEntry,
  cause: DraftChangesCatalogueEntry,
  role: 'head' | 'draft',
): ResolveCandidateViewsResult {
  if (isDeniedViewEntry(required, data.selection)) {
    return blocked({
      code: 'EXCLUDED_PREREQUISITE',
      message: 'A hard exclusion prevents the required default-view change.',
      tableCreatedId: required.target.tableCreatedId,
      ...(required.target.kind === 'view'
        ? { viewId: required.target.viewId }
        : {}),
      component: 'defaultViewId',
    });
  }
  return {
    status: 'needsEffects',
    requirements: [{ role, causeRef: cause.ref, refs: [required.ref] }],
  };
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
