import type {
  DraftChangesCatalogue,
  DraftChangesIdentityBinding,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';

export type EntityResolution =
  | { binding: DraftChangesIdentityBinding }
  | { blocker: 'UNKNOWN_TARGET' | 'AMBIGUOUS_IDENTITY' };

export function resolveTable(
  catalogue: DraftChangesCatalogue,
  tableId: string,
): EntityResolution {
  return resolveBinding(catalogue, 'table', undefined, tableId);
}

export function resolveRow(
  catalogue: DraftChangesCatalogue,
  tableCreatedId: string,
  rowId: string,
): EntityResolution {
  return resolveBinding(catalogue, 'row', tableCreatedId, rowId);
}

function resolveBinding(
  catalogue: DraftChangesCatalogue,
  kind: 'table' | 'row',
  tableCreatedId: string | undefined,
  publicId: string,
): EntityResolution {
  const bindings = catalogue.identityBindings.filter(
    (binding) =>
      binding.kind === kind &&
      (tableCreatedId === undefined ||
        binding.tableCreatedId === tableCreatedId) &&
      [...binding.headIds, ...binding.draftIds].includes(publicId),
  );
  if (bindings.length > 1) {
    return { blocker: 'AMBIGUOUS_IDENTITY' };
  }
  const binding = bindings[0];
  return binding ? { binding } : { blocker: 'UNKNOWN_TARGET' };
}
