import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { ResolvedDraftChangesSelection } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { CandidateForeignKeyReference } from './reference-graph';
import { readCandidateReferences } from './reference-graph';
import type { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';

export function referenceOriginRole(
  snapshot: DraftChangesSnapshot,
  operation: 'commit' | 'discard',
  candidateRole: 'head' | 'draft',
  reference: CandidateForeignKeyReference,
  selection: ResolvedDraftChangesSelection,
): 'head' | 'draft' {
  const selectedOrigin = selection.selected.some((entry) =>
    isReferenceSourceEntry(entry, reference),
  );
  if (selectedOrigin) {
    return operation === 'commit' ? 'draft' : 'head';
  }
  const selectedRowCreation = selection.selected.some(
    (entry) =>
      entry.kind === 'row' &&
      entry.classification === 'created' &&
      entry.target.kind === 'row' &&
      entry.target.tableCreatedId === reference.tableCreatedId &&
      entry.target.rowCreatedId === reference.rowCreatedId,
  );
  if (selectedRowCreation) {
    return operation === 'commit' ? 'draft' : 'head';
  }
  const original = candidateRole === 'head' ? 'head' : 'draft';
  const counterpart = candidateRole === 'head' ? 'draft' : 'head';
  const sourceRowExists = Boolean(findRow(snapshot[original], reference));
  return sourceRowExists ? original : counterpart;
}

export function referenceSchemaOriginRole(
  snapshot: DraftChangesSnapshot,
  operation: 'commit' | 'discard',
  candidateRole: 'head' | 'draft',
  reference: CandidateForeignKeyReference,
  selection: ResolvedDraftChangesSelection,
): 'head' | 'draft' {
  const selectedSchema = selection.selected.some(
    (entry) =>
      entry.kind === 'schemaField' &&
      entry.target.kind === 'schemaField' &&
      entry.target.tableCreatedId === reference.tableCreatedId &&
      entry.path === reference.schemaPath,
  );
  if (selectedSchema) {
    return operation === 'commit' ? 'draft' : 'head';
  }
  const counterpart = candidateRole === 'head' ? 'draft' : 'head';
  const originalRow = findTableByCreatedId(
    snapshot[candidateRole],
    reference.tableCreatedId,
  );
  return originalRow ? candidateRole : counterpart;
}

export function originalTargetBinding(
  snapshot: DraftChangesSnapshot,
  role: 'head' | 'draft',
  reference: CandidateForeignKeyReference,
):
  | {
      tableCreatedId: string;
    }
  | undefined {
  const state = snapshot[role] as unknown as DraftRevisionState;
  const table = state.tables.find(({ id }) => id === reference.targetTableId);
  if (!table) {
    return undefined;
  }
  return { tableCreatedId: table.createdId };
}

export interface OriginalReferenceLookup {
  references(role: 'head' | 'draft'): readonly CandidateForeignKeyReference[];
  find(
    role: 'head' | 'draft',
    reference: CandidateForeignKeyReference,
  ): CandidateForeignKeyReference | undefined;
}

interface RoleReferenceIndex {
  references: CandidateForeignKeyReference[];
  schema: Map<string, CandidateForeignKeyReference>;
  rowsByPath: Map<string, CandidateForeignKeyReference>;
  rowsByArrayOccurrence: Map<string, CandidateForeignKeyReference>;
  rowsBySchemaPath: Map<string, CandidateForeignKeyReference>;
}

export function createOriginalReferenceLookup(
  snapshot: DraftChangesSnapshot,
  schemaStores: JsonSchemaStoreService,
): OriginalReferenceLookup {
  const roles = {
    head: buildRoleReferenceIndex(snapshot, 'head', schemaStores),
    draft: buildRoleReferenceIndex(snapshot, 'draft', schemaStores),
  };
  return {
    references(role) {
      return roles[role].references;
    },
    find(role, reference) {
      return findOriginalReference(roles[role], reference);
    },
  };
}

function findOriginalReference(
  index: RoleReferenceIndex,
  reference: CandidateForeignKeyReference,
): CandidateForeignKeyReference | undefined {
  if (reference.kind === 'schema') {
    return index.schema.get(
      key(reference.tableCreatedId, reference.schemaPath),
    );
  }
  const identity = key(reference.tableCreatedId, reference.rowCreatedId);
  const exact = index.rowsByPath.get(key(identity, reference.path));
  if (exact) {
    return exact;
  }
  const wantedIndexes = arrayIndexes(reference.path);
  if (wantedIndexes.length > 0) {
    return index.rowsByArrayOccurrence.get(
      key(identity, reference.schemaPath, wantedIndexes),
    );
  }
  return index.rowsBySchemaPath.get(key(identity, reference.schemaPath));
}

function buildRoleReferenceIndex(
  snapshot: DraftChangesSnapshot,
  role: 'head' | 'draft',
  schemaStores: JsonSchemaStoreService,
): RoleReferenceIndex {
  const state = snapshot[role] as unknown as DraftRevisionState;
  const index: RoleReferenceIndex = {
    references: readCandidateReferences(state, role, schemaStores),
    schema: new Map(),
    rowsByPath: new Map(),
    rowsByArrayOccurrence: new Map(),
    rowsBySchemaPath: new Map(),
  };
  for (const reference of index.references) {
    if (reference.kind === 'schema') {
      setFirst(
        index.schema,
        key(reference.tableCreatedId, reference.schemaPath),
        reference,
      );
      continue;
    }
    const identity = key(reference.tableCreatedId, reference.rowCreatedId);
    setFirst(index.rowsByPath, key(identity, reference.path), reference);
    setFirst(
      index.rowsBySchemaPath,
      key(identity, reference.schemaPath),
      reference,
    );
    const indexes = arrayIndexes(reference.path);
    if (indexes.length > 0) {
      setFirst(
        index.rowsByArrayOccurrence,
        key(identity, reference.schemaPath, indexes),
        reference,
      );
    }
  }
  return index;
}

function setFirst<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key)) {
    map.set(key, value);
  }
}

function key(...parts: unknown[]): string {
  return JSON.stringify(parts);
}

function arrayIndexes(path: string): string[] {
  return path.split('/').filter((segment) => /^\d+$/.test(segment));
}

export function originalTargetRow(
  snapshot: DraftChangesSnapshot,
  role: 'head' | 'draft',
  tableCreatedId: string,
  rowId: string | undefined,
) {
  const roles = [role, role === 'head' ? 'draft' : 'head'] as const;
  for (const sourceRole of roles) {
    const table = (
      snapshot[sourceRole] as unknown as DraftRevisionState
    ).tables.find(({ createdId }) => createdId === tableCreatedId);
    const row = table?.rows.find(({ id }) => id === rowId);
    if (row) {
      return row;
    }
  }
  return undefined;
}

function isReferenceSourceEntry(
  entry: DraftChangesCatalogueEntry,
  reference: CandidateForeignKeyReference,
): boolean {
  if (
    entry.target.kind !== 'rowField' ||
    entry.target.tableCreatedId !== reference.tableCreatedId ||
    entry.target.rowCreatedId !== reference.rowCreatedId
  ) {
    return (
      entry.kind === 'schemaField' &&
      entry.target.kind === 'schemaField' &&
      entry.target.tableCreatedId === reference.tableCreatedId &&
      entry.path === reference.schemaPath
    );
  }
  return (
    (entry.path !== undefined && pathsOverlap(entry.path, reference.path)) ||
    (entry.previousPath !== undefined &&
      pathsOverlap(entry.previousPath, reference.path)) ||
    entry.path === reference.schemaPath
  );
}

function pathsOverlap(left: string, right: string): boolean {
  return (
    left === '' ||
    right === '' ||
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function findRow(
  state: DraftRevisionState,
  reference: CandidateForeignKeyReference,
) {
  return state.tables
    .find(({ createdId }) => createdId === reference.tableCreatedId)
    ?.rows.find(({ createdId }) => createdId === reference.rowCreatedId);
}

function findTableByCreatedId(
  state: DraftRevisionState,
  tableCreatedId: string,
) {
  return state.tables.find(({ createdId }) => createdId === tableCreatedId);
}
