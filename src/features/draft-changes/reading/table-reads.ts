import type { DraftChangesCatalogue } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type {
  DraftChangedTableItem,
  ReadDraftChangedTablesResult,
} from 'src/features/draft-changes/queries/impl/read-draft-changed-tables.query';
import type { ReadDraftTableChangesResult } from 'src/features/draft-changes/queries/impl/read-draft-table-changes.query';
import type { DraftChangesPage } from 'src/features/draft-changes/reading/pagination-types';
import {
  currentPublicId,
  previousPublicId,
  requireTableBinding,
} from 'src/features/draft-changes/reading/entity-identity';
import {
  entriesForTable,
  groupEntriesByTable,
  changedRowCreatedIds,
} from 'src/features/draft-changes/reading/catalogue-entries';
import { mapCatalogueLeaves } from 'src/features/draft-changes/reading/leaf-mapping';
import { paginateMap } from 'src/features/draft-changes/reading/pagination';

export function readChangedTables(
  catalogue: DraftChangesCatalogue,
  page: DraftChangesPage | undefined,
): ReadDraftChangedTablesResult {
  const entriesByTable = groupEntriesByTable(catalogue.entries);
  const tables = catalogue.identityBindings
    .filter(({ kind }) => kind === 'table')
    .sort(compareBindingIds)
    .flatMap((binding) => {
      const entries = entriesByTable.get(binding.entityCreatedId) ?? [];
      if (entries.length === 0) {
        return [];
      }
      return [{ binding, entries }];
    });

  return paginateMap(
    tables,
    page,
    {
      endpoint: 'tables',
      branchId: catalogue.scope.branchId,
      fingerprint: catalogue.scope.fingerprint,
      tableCreatedId: null,
      rowCreatedId: null,
    },
    ({ binding, entries }) => presentChangedTable(binding, entries),
  );
}

export function readTableDetails(
  catalogue: DraftChangesCatalogue,
  tableId: string,
): ReadDraftTableChangesResult {
  const binding = requireTableBinding(catalogue, tableId);
  const currentTableId = currentPublicId(binding);
  const entries = entriesForTable(catalogue, binding.entityCreatedId);
  const schemaChanges = entries.filter(({ kind }) => kind === 'schemaField');
  const viewsChanges = entries.filter(
    ({ kind }) => kind === 'view' || kind === 'viewConfiguration',
  );
  return {
    tableId: currentTableId,
    schemaChanges: mapCatalogueLeaves(schemaChanges),
    ...(viewsChanges.length > 0
      ? { viewsChanges: mapCatalogueLeaves(viewsChanges) }
      : {}),
    rowCount: changedRowCreatedIds(entries).size,
  };
}

function presentChangedTable(
  binding: DraftChangesCatalogue['identityBindings'][number],
  entries: ReturnType<typeof entriesForTable>,
): DraftChangedTableItem {
  const tableEntries = entries.filter(({ kind }) => kind === 'table');
  const childEntries = entries.filter(({ kind }) => kind !== 'table');
  const rowEntries = childEntries.filter(
    ({ kind }) => kind === 'row' || kind === 'rowField',
  );
  const tableRefs = entries.filter(
    ({ kind }) =>
      kind === 'table' ||
      kind === 'schemaField' ||
      kind === 'view' ||
      kind === 'viewConfiguration',
  );
  const changes = tableChanges(tableEntries, childEntries, rowEntries);

  return {
    tableId: currentPublicId(binding),
    previousTableId: previousPublicId(binding),
    changes,
    schemaFieldCount: entries.filter(({ kind }) => kind === 'schemaField')
      .length,
    changedRowCount: changedRowCreatedIds(rowEntries).size,
    refs: mapCatalogueLeaves(tableRefs),
  };
}

function tableChanges(
  tableEntries: ReturnType<typeof entriesForTable>,
  childEntries: ReturnType<typeof entriesForTable>,
  rowEntries: ReturnType<typeof entriesForTable>,
): string[] {
  const changes = new Set<string>(
    tableEntries.map(({ classification }) => classification),
  );
  const hasWholeTableLifecycle = tableEntries.some(
    ({ classification }) =>
      classification === 'created' || classification === 'deleted',
  );
  if (!hasWholeTableLifecycle) {
    if (childEntries.length > 0) {
      changes.add('updated');
    }
    if (rowEntries.length > 0) {
      changes.add('rowsChanged');
    }
  }
  return [...changes].sort(compareStrings);
}

function compareBindingIds(
  left: DraftChangesCatalogue['identityBindings'][number],
  right: DraftChangesCatalogue['identityBindings'][number],
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
