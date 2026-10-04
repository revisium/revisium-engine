import type {
  DraftChangesCatalogueEntry,
  DraftChangesFieldBoundary,
  DraftChangesIdentityBinding,
  BuildDraftChangesCatalogueResult,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { attachChangeReferences, uniqueEntries } from './change-references';

export interface TableCatalogueParts {
  entries: DraftChangesCatalogueEntry[];
  identityBindings: DraftChangesIdentityBinding[];
  fieldBoundaries: DraftChangesFieldBoundary[];
}

export function blockedCatalogueResult(
  code:
    | 'SCHEMA_PROJECTION_BLOCKED'
    | 'SCHEMA_PROJECTION_SNAPSHOT_MISMATCH'
    | 'SCHEMA_PROJECTION_TABLE_MISMATCH'
    | 'SCHEMA_PROJECTION_MISMATCH'
    | 'AMBIGUOUS_IDENTITY'
    | 'AMBIGUOUS_PATH',
  message: string,
  tableCreatedId?: string,
): BuildDraftChangesCatalogueResult {
  return { status: 'blocked', blockers: [{ code, message, tableCreatedId }] };
}

export function buildCatalogueResult(
  snapshot: DraftChangesSnapshot,
  tableBindings: DraftChangesIdentityBinding[],
  tableParts: TableCatalogueParts[],
): BuildDraftChangesCatalogueResult {
  const scope = {
    fingerprint: snapshot.fingerprint,
    branchId: snapshot.branch.id,
    headRevisionId: snapshot.head.id,
    draftRevisionId: snapshot.draft.id,
  };
  const entries = tableParts.flatMap(({ entries: part }) => part);
  const identityBindings = [
    ...tableBindings,
    ...tableParts.flatMap(({ identityBindings: bindings }) => bindings),
  ];
  const fieldBoundaries = tableParts.flatMap(
    ({ fieldBoundaries: boundaries }) => boundaries,
  );
  const referencedEntries = attachChangeReferences(entries, scope);
  return {
    status: 'catalogued',
    catalogue: structuredClone({
      scope,
      identityBindings,
      fieldBoundaries,
      entries: uniqueEntries(referencedEntries),
    }),
  };
}
