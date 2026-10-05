import type {
  CandidateBlocker,
  CandidateRequirement,
  CalculateDataCandidatesQueryData,
  ResolvedDraftChangesSelection,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type {
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { findTable } from './candidate-state';

type ParentRequirementResult =
  | CandidateRequirement
  | CandidateBlocker
  | undefined;

export function findIdentityPrerequisite(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  blockers: CandidateBlocker[],
): CandidateRequirement | undefined {
  const collision = blockers.find(({ code }) => code === 'IDENTITY_CONFLICT');
  if (!collision || collision.identityId === undefined) {
    return undefined;
  }
  const selected = data.selection.selected.find((entry) => {
    const identity = data.operation === 'commit' ? entry.after : entry.before;
    return matchesConflict(identity, collision);
  });
  if (!selected) {
    return undefined;
  }
  const conflicts = data.catalogue.entries.filter((entry) =>
    conflictsWithSelectedIdentity(entry, selected.ref.value, collision),
  );
  const conflict = conflicts.length === 1 ? conflicts[0] : undefined;
  if (!conflict || isDenied(data.selection, conflict)) {
    return undefined;
  }
  return {
    role: data.operation === 'commit' ? 'head' : 'draft',
    causeRef: selected.ref,
    kind: 'catalogueEffects',
    refs: [conflict.ref],
  };
}

function matchesConflict(
  identity: unknown,
  collision: CandidateBlocker,
): boolean {
  if (typeof identity !== 'string' || collision.identityId === undefined) {
    return false;
  }
  return collision.identityScope === 'rowId'
    ? identity === collision.identityId
    : identity.toLowerCase() === collision.identityId.toLowerCase();
}

function conflictsWithSelectedIdentity(
  entry: DraftChangesCatalogueEntry,
  selectedRef: string,
  collision: CandidateBlocker,
): boolean {
  if (entry.ref.value === selectedRef) {
    return false;
  }
  if (
    collision.identityScope === 'rowId' &&
    entry.target.kind === 'row' &&
    entry.target.tableCreatedId === collision.tableCreatedId
  ) {
    return (
      entry.before === collision.identityId ||
      entry.after === collision.identityId
    );
  }
  return (
    collision.identityScope === 'tableId' &&
    entry.target.kind === 'table' &&
    [entry.before, entry.after].some(
      (identity) =>
        typeof identity === 'string' &&
        identity.toLowerCase() === collision.identityId?.toLowerCase(),
    )
  );
}

export function missingParentRequirement(
  operation: 'commit' | 'discard',
  targetState: DraftRevisionState,
  catalogue: DraftChangesCatalogue,
  selection: ResolvedDraftChangesSelection,
): ParentRequirementResult {
  const role = operation === 'commit' ? 'head' : 'draft';
  for (const entry of selection.selected) {
    const tableRequirement = tableRowsRequirement(
      operation,
      targetState,
      catalogue,
      selection,
      entry,
      role,
    );
    if (tableRequirement) {
      return tableRequirement;
    }
    const parentRequirement = missingTableRequirement(
      operation,
      targetState,
      catalogue,
      selection,
      entry,
      role,
    );
    if (parentRequirement) {
      return parentRequirement;
    }
  }
  return undefined;
}

function tableRowsRequirement(
  operation: 'commit' | 'discard',
  targetState: DraftRevisionState,
  catalogue: DraftChangesCatalogue,
  selection: ResolvedDraftChangesSelection,
  entry: DraftChangesCatalogueEntry,
  role: 'head' | 'draft',
): ParentRequirementResult {
  if (entry.kind !== 'table' || entry.target.kind !== 'table') {
    return undefined;
  }
  const tableTarget = entry.target;
  const classification = operation === 'commit' ? 'deleted' : 'created';
  if (entry.classification !== classification) {
    return undefined;
  }
  const table = findTable(targetState, entry.target.tableCreatedId);
  const lifecycle = operation === 'commit' ? 'deleted' : 'created';
  const rowIds = new Set(table?.rows.map(({ createdId }) => createdId) ?? []);
  const selectedRefs = new Set(selection.selected.map(({ ref }) => ref.value));
  const requiredRows = catalogue.entries.filter((candidate) => {
    if (candidate.kind !== 'row' || candidate.target.kind !== 'row') {
      return false;
    }
    const rowTarget = candidate.target;
    return (
      rowTarget.tableCreatedId === tableTarget.tableCreatedId &&
      rowIds.has(rowTarget.rowCreatedId) &&
      candidate.classification === lifecycle
    );
  });
  const missing = requiredRows.filter(
    (row) => !selectedRefs.has(row.ref.value),
  );
  if (missing.length === 0) {
    return undefined;
  }
  const denied = missing.find((row) => isDenied(selection, row));
  if (denied?.target.kind === 'row') {
    return {
      code: 'EXCLUDED_PREREQUISITE',
      role,
      tableCreatedId: entry.target.tableCreatedId,
      rowCreatedId: denied.target.rowCreatedId,
      message: 'A required row lifecycle change is excluded.',
    };
  }
  return {
    role,
    causeRef: entry.ref,
    kind: 'catalogueEffects',
    refs: missing.map(({ ref }) => ref),
  };
}

function missingTableRequirement(
  operation: 'commit' | 'discard',
  targetState: DraftRevisionState,
  catalogue: DraftChangesCatalogue,
  selection: ResolvedDraftChangesSelection,
  entry: DraftChangesCatalogueEntry,
  role: 'head' | 'draft',
): CandidateRequirement | CandidateBlocker | undefined {
  if (entry.kind !== 'row' || entry.target.kind !== 'row') {
    return undefined;
  }
  if (operation === 'discard' && entry.classification === 'deleted') {
    const parent = catalogue.entries.find(
      (candidate) =>
        candidate.kind === 'table' &&
        candidate.target.kind === 'table' &&
        candidate.target.tableCreatedId === entry.target.tableCreatedId &&
        candidate.classification === 'deleted',
    );
    if (parent && !findTable(targetState, entry.target.tableCreatedId)) {
      return requiredParentResult(parent, entry, selection, role, 'restore');
    }
  }
  if (
    entry.classification === 'created' &&
    !findTable(targetState, entry.target.tableCreatedId)
  ) {
    const parent = catalogue.entries.find(
      (candidate) =>
        candidate.kind === 'table' &&
        candidate.target.kind === 'table' &&
        candidate.target.tableCreatedId === entry.target.tableCreatedId &&
        candidate.classification === 'created',
    );
    if (parent) {
      return requiredParentResult(parent, entry, selection, role, 'create');
    }
  }
  return undefined;
}

function requiredParentResult(
  parent: DraftChangesCatalogueEntry,
  cause: DraftChangesCatalogueEntry,
  selection: ResolvedDraftChangesSelection,
  role: 'head' | 'draft',
  action: 'create' | 'restore',
): CandidateRequirement | CandidateBlocker | undefined {
  if (isDenied(selection, parent)) {
    return {
      code: 'EXCLUDED_PREREQUISITE',
      role,
      tableCreatedId:
        parent.target.kind === 'table'
          ? parent.target.tableCreatedId
          : undefined,
      ...(cause.target.kind === 'row'
        ? { rowCreatedId: cause.target.rowCreatedId }
        : {}),
      message: `The required table ${action === 'create' ? 'creation' : 'restoration'} is excluded.`,
    };
  }
  if (!selection.selected.some(({ ref }) => ref.value === parent.ref.value)) {
    return {
      role,
      causeRef: cause.ref,
      kind: 'catalogueEffects',
      refs: [parent.ref],
    };
  }
  return undefined;
}

function isDenied(
  selection: ResolvedDraftChangesSelection,
  entry: DraftChangesCatalogueEntry,
): boolean {
  return selection.deniedTargets.some((target) => {
    if (target.kind === 'change') {
      return target.ref.value === entry.ref.value;
    }
    if (entry.target.kind === 'table') {
      return (
        target.kind === 'table' &&
        target.tableCreatedId === entry.target.tableCreatedId &&
        target.facets.includes('lifecycle')
      );
    }
    if (entry.target.kind === 'row') {
      return (
        target.kind === 'row' &&
        target.tableCreatedId === entry.target.tableCreatedId &&
        target.rowCreatedId === entry.target.rowCreatedId &&
        target.facets.includes('lifecycle')
      );
    }
    if (entry.target.kind === 'rowField') {
      return (
        target.kind === 'row' &&
        target.tableCreatedId === entry.target.tableCreatedId &&
        target.rowCreatedId === entry.target.rowCreatedId &&
        target.facets.includes('rowFields')
      );
    }
    if (entry.target.kind === 'schemaField') {
      return (
        target.kind === 'table' &&
        target.tableCreatedId === entry.target.tableCreatedId &&
        target.facets.includes('schemaFields')
      );
    }
    return false;
  });
}
