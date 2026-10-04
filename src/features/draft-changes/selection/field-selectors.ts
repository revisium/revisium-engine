import type {
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
  DraftChangesChoice,
  DraftChangesFieldBoundary,
} from 'src/features/draft-changes/queries/impl';
import { resolveRow, resolveTable } from './entity-selectors';

export type FieldSelectorResult =
  | { entries: DraftChangesCatalogueEntry[]; blocker?: undefined }
  | {
      blocker:
        | 'UNKNOWN_TARGET'
        | 'AMBIGUOUS_IDENTITY'
        | 'ATOMIC_DESCENDANT'
        | 'NON_SELECTABLE';
    };

export function selectFieldEntries(
  catalogue: DraftChangesCatalogue,
  choice: Extract<DraftChangesChoice, { kind: 'rowFields' | 'schemaFields' }>,
): FieldSelectorResult {
  const table = resolveTable(catalogue, choice.tableId);
  if ('blocker' in table) {
    return { blocker: table.blocker };
  }
  const tableCreatedId = table.binding.entityCreatedId;
  if (choice.kind === 'schemaFields') {
    const paths = choice.paths ?? 'all';
    return {
      entries: catalogue.entries.filter(
        (entry) =>
          entry.kind === 'schemaField' &&
          entry.target.tableCreatedId === tableCreatedId &&
          pathMatches(paths, entry.path ?? ''),
      ),
    };
  }

  const row = resolveRow(catalogue, tableCreatedId, choice.rowId);
  if ('blocker' in row) {
    return { blocker: row.blocker };
  }
  const rowCreatedId = row.binding.entityCreatedId;
  const paths = choice.paths ?? 'all';
  if (hasFieldIntent(paths)) {
    const lifecycleRow = catalogue.entries.some(
      (entry) =>
        entry.kind === 'row' &&
        entry.target.kind === 'row' &&
        entry.target.tableCreatedId === tableCreatedId &&
        entry.target.rowCreatedId === rowCreatedId &&
        (entry.classification === 'created' ||
          entry.classification === 'deleted'),
    );
    if (lifecycleRow) {
      return { blocker: 'ATOMIC_DESCENDANT' };
    }
  }
  if (paths !== 'all') {
    const rowAtomicChange = catalogue.entries.some(
      (entry) =>
        entry.kind === 'rowField' &&
        entry.target.kind === 'rowField' &&
        entry.target.tableCreatedId === tableCreatedId &&
        entry.target.rowCreatedId === rowCreatedId &&
        entry.classification === 'atomic' &&
        paths.some(
          (selected) =>
            selected !== entry.path && isDescendant(selected, entry.path ?? ''),
        ),
    );
    if (rowAtomicChange) {
      return { blocker: 'ATOMIC_DESCENDANT' };
    }
    const boundary = findAtomicBoundary(
      catalogue.fieldBoundaries,
      tableCreatedId,
      paths,
    );
    if (boundary) {
      return { blocker: 'ATOMIC_DESCENDANT' };
    }
    if (
      hasUnselectableComputedBoundary(
        catalogue,
        tableCreatedId,
        rowCreatedId,
        paths,
      )
    ) {
      return { blocker: 'NON_SELECTABLE' };
    }
  }
  return {
    entries: catalogue.entries.filter(
      (entry) =>
        entry.kind === 'rowField' &&
        entry.target.kind === 'rowField' &&
        entry.target.tableCreatedId === tableCreatedId &&
        entry.target.rowCreatedId === rowCreatedId &&
        pathMatches(paths, entry.path ?? '') &&
        (paths !== 'all' || entry.selectable),
    ),
  };
}

function hasFieldIntent(paths: 'all' | string[]): boolean {
  return paths === 'all' || paths.length > 0;
}

function isSelectableComputedArray(
  catalogue: DraftChangesCatalogue,
  tableCreatedId: string,
  rowCreatedId: string,
  paths: 'all' | string[],
  boundaryPath: string,
): boolean {
  if (paths === 'all') {
    return false;
  }
  const arrayPaths = paths.filter((path) => isDescendant(boundaryPath, path));
  return (
    arrayPaths.length > 0 &&
    arrayPaths.every((path) =>
      catalogue.entries.some(
        (entry) =>
          entry.kind === 'rowField' &&
          entry.target.kind === 'rowField' &&
          entry.target.tableCreatedId === tableCreatedId &&
          entry.target.rowCreatedId === rowCreatedId &&
          entry.path === path &&
          entry.classification === 'atomic' &&
          entry.selectable,
      ),
    )
  );
}

function hasUnselectableComputedBoundary(
  catalogue: DraftChangesCatalogue,
  tableCreatedId: string,
  rowCreatedId: string,
  paths: string[],
): boolean {
  return catalogue.fieldBoundaries.some(
    (boundary) =>
      boundary.tableCreatedId === tableCreatedId &&
      boundary.kind === 'computed' &&
      pathsMatchOrOverlap(paths, boundary.path) &&
      !isSelectableComputedArray(
        catalogue,
        tableCreatedId,
        rowCreatedId,
        paths,
        boundary.path,
      ),
  );
}

function findAtomicBoundary(
  boundaries: DraftChangesFieldBoundary[],
  tableCreatedId: string,
  paths: string[],
): DraftChangesFieldBoundary | undefined {
  return boundaries.find(
    ({ tableCreatedId: id, path, kind }) =>
      id === tableCreatedId &&
      kind !== 'computed' &&
      paths.some((selected) => isDescendant(selected, path)),
  );
}

function pathMatches(paths: 'all' | string[], candidate: string): boolean {
  return (
    paths === 'all' ||
    paths.some((path) => candidate === path || isDescendant(candidate, path))
  );
}

function pathsMatchOrOverlap(
  paths: 'all' | string[],
  candidate: string,
): boolean {
  return (
    paths === 'all' ||
    paths.some(
      (path) =>
        path === candidate ||
        isDescendant(path, candidate) ||
        isDescendant(candidate, path),
    )
  );
}

function isDescendant(path: string, parent: string): boolean {
  return parent === '' ? path !== '' : path.startsWith(`${parent}/`);
}
