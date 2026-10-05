import type {
  DraftChangeRef,
  DraftChangesCatalogueEntry,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { ResolvedDraftChangesSelection } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { CandidateSchemaProjectionBinding } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { CandidateViewTarget } from 'src/features/draft-changes/queries/impl/resolve-candidate-views.query';

export function selectedViewRefs(
  selection: ResolvedDraftChangesSelection,
  effectiveRefs: DraftChangeRef[],
): Set<string> {
  return new Set([
    ...selection.selected.map(({ ref }) => ref.value),
    ...effectiveRefs.map(({ value }) => value),
  ]);
}

export function isDeniedViewEntry(
  entry: DraftChangesCatalogueEntry,
  selection: ResolvedDraftChangesSelection,
): boolean {
  if (
    entry.target.kind !== 'view' &&
    entry.target.kind !== 'viewConfiguration'
  ) {
    return false;
  }
  return selection.deniedTargets.some((denied) => {
    if (denied.kind === 'change') {
      return denied.ref.value === entry.ref.value;
    }
    return (
      denied.kind === 'table' &&
      denied.tableCreatedId === entry.target.tableCreatedId &&
      denied.facets.includes('views')
    );
  });
}

export function isDeniedTableLifecycleEntry(
  entry: DraftChangesCatalogueEntry,
  selection: ResolvedDraftChangesSelection,
): boolean {
  if (entry.target.kind !== 'table') {
    return false;
  }
  return selection.deniedTargets.some((denied) => {
    if (denied.kind === 'change') {
      return denied.ref.value === entry.ref.value;
    }
    return (
      denied.kind === 'table' &&
      denied.tableCreatedId === entry.target.tableCreatedId &&
      denied.facets.includes('lifecycle')
    );
  });
}

export function shouldApplyViewEntry(
  entry: DraftChangesCatalogueEntry,
  operation: 'commit' | 'discard',
  role: 'head' | 'draft',
  selectedRefs: Set<string>,
  selection: ResolvedDraftChangesSelection,
): boolean {
  const denied = isDeniedViewEntry(entry, selection);
  const selected = selectedRefs.has(entry.ref.value) && !denied;
  if (operation === 'commit' && role === 'head') {
    return selected;
  }
  if (operation === 'discard' && role === 'draft') {
    return !selected;
  }
  return false;
}

export function viewEntriesForTable(
  entries: DraftChangesCatalogueEntry[],
  tableCreatedId: string,
): DraftChangesCatalogueEntry[] {
  return entries.filter(
    ({ target }) =>
      (target.kind === 'view' || target.kind === 'viewConfiguration') &&
      target.tableCreatedId === tableCreatedId,
  );
}

export function projectionBindingForTable(
  bindings: CandidateSchemaProjectionBinding[],
  tableCreatedId: string,
): CandidateSchemaProjectionBinding | undefined {
  return bindings.find((binding) => binding.tableCreatedId === tableCreatedId);
}

export function targetMatchesView(
  target: CandidateViewTarget,
  entry: DraftChangesCatalogueEntry,
): boolean {
  return (
    entry.target.kind === target.kind &&
    entry.target.tableCreatedId === target.tableCreatedId &&
    (target.kind === 'view'
      ? entry.target.kind === 'view' &&
        entry.target.viewId === target.viewId &&
        entry.target.component === target.component
      : entry.target.kind === 'viewConfiguration' &&
        entry.target.component === target.component)
  );
}
