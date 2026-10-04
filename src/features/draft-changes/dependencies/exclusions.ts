import type { CalculateDataCandidatesQueryData } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesDeniedTarget } from 'src/features/draft-changes/queries/impl/resolve-draft-changes-selection.query';
import type { CandidateForeignKeyReference } from './reference-graph';

type SelectedData = Extract<
  CalculateDataCandidatesQueryData,
  { mode: 'selected' }
>;
type NonChangeDeniedTarget = Exclude<
  DraftChangesDeniedTarget,
  { kind: 'change' }
>;

export function isCatalogueEntryDenied(
  data: SelectedData,
  entry: DraftChangesCatalogueEntry,
): boolean {
  return data.selection.deniedTargets.some((target) =>
    catalogueEntryDeniedByTarget(target, entry),
  );
}

function catalogueEntryDeniedByTarget(
  target: DraftChangesDeniedTarget,
  entry: DraftChangesCatalogueEntry,
): boolean {
  if (target.kind === 'change') {
    return target.ref.value === entry.ref.value;
  }
  if (entry.target.kind === 'table' || entry.target.kind === 'row') {
    return false;
  }
  if (target.tableCreatedId !== entry.target.tableCreatedId) {
    return false;
  }
  if (target.kind === 'table') {
    return deniedByTableFacet(target.facets, entry);
  }
  if (entry.target.kind === 'schemaField') {
    return deniedSchemaEntry(target, entry);
  }
  if (entry.target.kind !== 'rowField') {
    return target.kind === 'row' && target.facets.includes('rowFields');
  }
  return deniedRowEntry(target, entry, entry.target.rowCreatedId);
}

function deniedByTableFacet(
  facets: Array<'lifecycle' | 'rows' | 'schemaFields'>,
  entry: DraftChangesCatalogueEntry,
): boolean {
  return (
    (entry.kind === 'row' && facets.includes('rows')) ||
    (entry.kind === 'schemaField' && facets.includes('schemaFields'))
  );
}

function deniedSchemaEntry(
  target: NonChangeDeniedTarget,
  entry: DraftChangesCatalogueEntry,
): boolean {
  if (target.kind === 'schemaField') {
    return target.path === entry.path;
  }
  return (
    target.kind === 'schemaFields' &&
    (target.paths === 'all' || target.paths.includes(entry.path ?? ''))
  );
}

function deniedRowEntry(
  target: NonChangeDeniedTarget,
  entry: DraftChangesCatalogueEntry,
  rowCreatedId: string,
): boolean {
  if (target.kind === 'row' && target.rowCreatedId === rowCreatedId) {
    return target.facets.includes('rowFields');
  }
  if (target.kind === 'rowField') {
    return target.rowCreatedId === rowCreatedId && target.path === entry.path;
  }
  return (
    target.kind === 'rowFields' &&
    target.rowCreatedId === rowCreatedId &&
    (target.paths === 'all' || target.paths.includes(entry.path ?? ''))
  );
}

export function excludedForeignKeyPath(
  data: SelectedData,
  reference: CandidateForeignKeyReference,
): string | undefined {
  for (const target of data.selection.deniedTargets) {
    const path = excludedPath(target, reference);
    if (path !== undefined) {
      return path;
    }
  }
  return undefined;
}

function excludedPath(
  target: DraftChangesDeniedTarget,
  reference: CandidateForeignKeyReference,
): string | undefined {
  if (target.kind === 'change') {
    return excludedChangedReference(target, reference);
  }
  if (reference.kind === 'schema') {
    return excludedSchemaReference(target, reference);
  }
  return excludedRowReference(target, reference);
}

function excludedChangedReference(
  target: Extract<
    SelectedData['selection']['deniedTargets'][number],
    { kind: 'change' }
  >,
  reference: CandidateForeignKeyReference,
): string | undefined {
  if (!('tableCreatedId' in target.target)) {
    return undefined;
  }
  if (target.target.tableCreatedId !== reference.tableCreatedId) {
    return undefined;
  }
  if (
    target.target.kind === 'schemaField' &&
    reference.kind === 'schema' &&
    target.target.path === reference.schemaPath
  ) {
    return reference.schemaPath;
  }
  if (
    target.target.kind === 'rowField' &&
    reference.kind === 'row' &&
    target.target.rowCreatedId === reference.rowCreatedId &&
    pathsOverlap(target.target.path, reference.path)
  ) {
    return reference.path;
  }
  return undefined;
}

function excludedSchemaReference(
  target: NonChangeDeniedTarget,
  reference: CandidateForeignKeyReference,
): string | undefined {
  if (reference.kind !== 'schema') {
    return undefined;
  }
  if (
    target.kind === 'schemaField' &&
    target.tableCreatedId === reference.tableCreatedId &&
    target.path === reference.schemaPath
  ) {
    return target.path;
  }
  if (
    target.kind === 'schemaFields' &&
    target.tableCreatedId === reference.tableCreatedId &&
    (target.paths === 'all' || target.paths.includes(reference.schemaPath))
  ) {
    return target.paths === 'all' ? '' : reference.schemaPath;
  }
  if (
    target.kind === 'table' &&
    target.tableCreatedId === reference.tableCreatedId &&
    target.facets.includes('schemaFields')
  ) {
    return reference.schemaPath;
  }
  return undefined;
}

function excludedRowReference(
  target: NonChangeDeniedTarget,
  reference: CandidateForeignKeyReference,
): string | undefined {
  if (reference.kind !== 'row') {
    return undefined;
  }
  if (target.tableCreatedId !== reference.tableCreatedId) {
    return undefined;
  }
  if (
    target.kind === 'table' &&
    (target.facets.includes('rows') || target.facets.includes('lifecycle'))
  ) {
    return '';
  }
  if (
    target.kind === 'row' &&
    target.rowCreatedId === reference.rowCreatedId &&
    (target.facets.includes('rowFields') || target.facets.includes('lifecycle'))
  ) {
    return '';
  }
  if (
    target.kind === 'rowField' &&
    target.rowCreatedId === reference.rowCreatedId &&
    pathsOverlap(target.path, reference.path)
  ) {
    return target.path;
  }
  if (
    target.kind === 'rowFields' &&
    target.rowCreatedId === reference.rowCreatedId
  ) {
    if (target.paths === 'all') {
      return '';
    }
    return target.paths.find((path) => pathsOverlap(path, reference.path));
  }
  return undefined;
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
