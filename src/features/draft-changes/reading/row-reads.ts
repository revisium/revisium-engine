import type {
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
  DraftChangesIdentityBinding,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type {
  DraftChangedRowItem,
  ReadDraftChangedRowsResult,
} from 'src/features/draft-changes/queries/impl/read-draft-changed-rows.query';
import type { ReadDraftRowChangesResult } from 'src/features/draft-changes/queries/impl/read-draft-row-changes.query';
import type { DraftChangesPage } from 'src/features/draft-changes/reading/pagination-types';
import {
  currentPublicId,
  previousPublicId,
} from 'src/features/draft-changes/reading/entity-identity';
import {
  entriesForRow,
  groupRowEntries,
} from 'src/features/draft-changes/reading/catalogue-entries';
import {
  mapCatalogueLeaf,
  mapCatalogueLeaves,
} from 'src/features/draft-changes/reading/leaf-mapping';
import { paginateMap } from 'src/features/draft-changes/reading/pagination';

const MAX_BROWSE_ROW_REFS = 100;

export function readChangedRows(
  catalogue: DraftChangesCatalogue,
  tableBinding: DraftChangesIdentityBinding,
  page: DraftChangesPage | undefined,
): ReadDraftChangedRowsResult {
  const entriesByRow = groupRowEntries(
    catalogue.entries,
    tableBinding.entityCreatedId,
  );
  const rows = catalogue.identityBindings
    .filter(
      ({ kind, tableCreatedId }) =>
        kind === 'row' && tableCreatedId === tableBinding.entityCreatedId,
    )
    .sort(compareBindingIds)
    .flatMap((binding) => {
      const entries = entriesByRow.get(binding.entityCreatedId) ?? [];
      if (entries.length === 0) {
        return [];
      }
      return [{ binding, entries }];
    });

  return paginateMap(
    rows,
    page,
    {
      endpoint: 'rows',
      branchId: catalogue.scope.branchId,
      fingerprint: catalogue.scope.fingerprint,
      tableCreatedId: tableBinding.entityCreatedId,
      rowCreatedId: null,
    },
    ({ binding, entries }) => presentChangedRow(tableBinding, binding, entries),
  );
}

export function readRowDetails(
  catalogue: DraftChangesCatalogue,
  tableBinding: DraftChangesIdentityBinding,
  rowBinding: DraftChangesIdentityBinding,
  page: DraftChangesPage | undefined,
): ReadDraftRowChangesResult {
  const entries = entriesForRow(
    catalogue,
    tableBinding.entityCreatedId,
    rowBinding.entityCreatedId,
  );
  const connection = paginateMap(
    sortRowEntries(entries),
    page,
    {
      endpoint: 'rowDetails',
      branchId: catalogue.scope.branchId,
      fingerprint: catalogue.scope.fingerprint,
      tableCreatedId: tableBinding.entityCreatedId,
      rowCreatedId: rowBinding.entityCreatedId,
    },
    mapCatalogueLeaf,
  );
  return {
    tableId: currentPublicId(tableBinding),
    rowId: currentPublicId(rowBinding),
    changes: connection.edges.map(({ node }) => node),
    totalCount: connection.totalCount,
    pageInfo: connection.pageInfo,
  };
}

function presentChangedRow(
  tableBinding: DraftChangesIdentityBinding,
  rowBinding: DraftChangesIdentityBinding,
  entries: DraftChangesCatalogueEntry[],
): DraftChangedRowItem {
  const orderedEntries = sortRowEntries(entries);
  const rowFieldEntries = entries.filter(({ kind }) => kind === 'rowField');
  const rowEntityEntries = entries.filter(({ kind }) => kind === 'row');
  const refs = mapCatalogueLeaves(orderedEntries.slice(0, MAX_BROWSE_ROW_REFS));

  return {
    tableId: currentPublicId(tableBinding),
    rowId: currentPublicId(rowBinding),
    previousRowId: previousPublicId(rowBinding),
    changes: rowChanges(rowEntityEntries, rowFieldEntries),
    changedFieldCount: rowFieldEntries.length,
    hasMoreChanges: orderedEntries.length > MAX_BROWSE_ROW_REFS,
    refs,
  };
}

function rowChanges(
  rowEntityEntries: DraftChangesCatalogueEntry[],
  rowFieldEntries: DraftChangesCatalogueEntry[],
): string[] {
  const changes = new Set(
    rowEntityEntries.map(({ classification }) => classification),
  );
  if (rowFieldEntries.length > 0) {
    changes.add('updated');
  }
  return [...changes].sort(compareStrings);
}

function sortRowEntries(
  entries: DraftChangesCatalogueEntry[],
): DraftChangesCatalogueEntry[] {
  return [...entries].sort((left, right) => {
    const leftRank = left.kind === 'row' ? 0 : 1;
    const rightRank = right.kind === 'row' ? 0 : 1;
    return (
      leftRank - rightRank ||
      compareStrings(left.path ?? '', right.path ?? '') ||
      compareStrings(left.ref.value, right.ref.value)
    );
  });
}

function compareBindingIds(
  left: DraftChangesIdentityBinding,
  right: DraftChangesIdentityBinding,
): number {
  return compareStrings(left.entityCreatedId, right.entityCreatedId);
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
