import {
  ResolveDraftChangesSelectionQuery,
  type DraftChangeRef,
  type DraftChangesCatalogue,
  type DraftChangesCatalogueEntry,
  type DraftChangesCatalogueEntryKind,
  type DraftChangesFieldBoundary,
  type DraftChangesCatalogueTarget,
  type DraftChangesIdentityBinding,
  type DraftChangesSelection,
} from 'src/features/draft-changes/queries/impl';

export function atomicPathSelection(
  choice: Extract<
    DraftChangesSelection['include'][number],
    { kind: 'rowFields' }
  >,
  direction: 'include' | 'exclude',
) {
  return direction === 'include'
    ? { include: [choice] }
    : { include: [{ kind: 'all' as const }], exclude: [choice] };
}
import { ResolveDraftChangesSelectionHandler } from 'src/features/draft-changes/queries/handlers/resolve-draft-changes-selection.handler';

export function changeEntry(
  kind: DraftChangesCatalogueEntryKind,
  ref: string,
  target: DraftChangesCatalogueTarget,
  options: {
    path?: string;
    classification?: DraftChangesCatalogueEntry['classification'];
    selectable?: boolean;
  } = {},
): DraftChangesCatalogueEntry {
  return {
    kind,
    ref: { value: ref },
    target,
    classification: options.classification ?? 'updated',
    path: options.path,
    beforeExists: true,
    afterExists: true,
    selectable: options.selectable ?? true,
  };
}

export function selectionCatalogue(
  options: {
    entries?: DraftChangesCatalogueEntry[];
    fieldBoundaries?: DraftChangesFieldBoundary[];
    identityBindings?: DraftChangesIdentityBinding[];
    fingerprint?: string;
    branchId?: string;
    headRevisionId?: string;
    draftRevisionId?: string;
  } = {},
): DraftChangesCatalogue {
  return {
    scope: {
      fingerprint: options.fingerprint ?? 'fingerprint-a',
      branchId: options.branchId ?? 'branch-a',
      headRevisionId: options.headRevisionId ?? 'head-a',
      draftRevisionId: options.draftRevisionId ?? 'draft-a',
    },
    identityBindings: withKnownIdentityBindings(options),
    fieldBoundaries: options.fieldBoundaries ?? [],
    entries: options.entries ?? [],
  };
}

function withKnownIdentityBindings(options: {
  identityBindings?: DraftChangesIdentityBinding[];
  entries?: DraftChangesCatalogueEntry[];
}): DraftChangesIdentityBinding[] {
  const bindings = [...(options.identityBindings ?? [])];
  const targets = options.entries ?? [];
  for (const entry of targets) {
    const target = entry.target;
    const { tableCreatedId, tableId } = target;
    if (
      !bindings.some(
        (binding) =>
          binding.kind === 'table' &&
          binding.entityCreatedId === tableCreatedId,
      )
    ) {
      bindings.push({
        kind: 'table',
        tableCreatedId,
        entityCreatedId: tableCreatedId,
        headIds: [tableId],
        draftIds: [tableId],
      });
    }
    if (target.kind === 'row' || target.kind === 'rowField') {
      if (
        !bindings.some(
          (binding) =>
            binding.kind === 'row' &&
            binding.entityCreatedId === target.rowCreatedId,
        )
      ) {
        bindings.push({
          kind: 'row',
          tableCreatedId,
          entityCreatedId: target.rowCreatedId,
          headIds: [target.rowId],
          draftIds: [target.rowId],
        });
      }
    }
  }
  if (!bindings.some(({ kind }) => kind === 'table')) {
    bindings.push({
      kind: 'table',
      tableCreatedId: 'table-created',
      entityCreatedId: 'table-created',
      headIds: ['products'],
      draftIds: ['products'],
    });
  }
  return bindings;
}

export async function resolveSelection(
  catalogue: DraftChangesCatalogue,
  selection: DraftChangesSelection,
) {
  return new ResolveDraftChangesSelectionHandler().execute(
    new ResolveDraftChangesSelectionQuery({ catalogue, selection }),
  );
}

export function ref(value: string): DraftChangeRef {
  return { value };
}

export function requiredResolvedRowField(
  result: Awaited<ReturnType<typeof resolveSelection>>,
): Extract<DraftChangesCatalogueTarget, { kind: 'rowField' }> {
  if (result.status !== 'resolved') {
    throw new Error('Expected selection resolution.');
  }
  const selected = result.selected[0];
  if (!selected || selected.target.kind !== 'rowField') {
    throw new Error('Expected a selected row field.');
  }
  return selected.target as Extract<
    DraftChangesCatalogueTarget,
    { kind: 'rowField' }
  >;
}

export function requiredEntryRef(
  catalogue: DraftChangesCatalogue,
): DraftChangeRef {
  const entry = catalogue.entries[0];
  if (!entry) {
    throw new Error('Expected a catalogue change.');
  }
  return entry.ref;
}
