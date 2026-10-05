import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { TableViewsData, View } from 'src/features/views/types';
import { SystemTables } from 'src/features/share/system-tables.consts';

export function tableViews(name = 'Default'): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'main',
    views: [
      {
        id: 'main',
        name,
        columns: [
          { field: 'data.price', width: 100 },
          { field: 'data.title', width: 100 },
        ],
        sorts: [],
        search: '',
      },
    ],
  };
}

export function mainView(views: TableViewsData): View {
  const result = views.views.find(({ id }) => id === 'main');
  if (!result) {
    throw new Error('Expected the main view in the fixture.');
  }
  return result;
}

export function renameMainView(
  views: TableViewsData,
  name: string,
): TableViewsData {
  return {
    ...views,
    views: views.views.map((view) =>
      view.id === 'main' ? { ...view, name } : view,
    ),
  };
}

export function addView(
  views: TableViewsData,
  id: string,
  name: string,
): TableViewsData {
  return {
    ...views,
    views: [
      ...views.views,
      { id, name, columns: [{ field: 'data.price', width: 100 }] },
    ],
  };
}

export function withViewsVersion(
  views: TableViewsData,
  version: number,
): TableViewsData {
  return { ...views, version };
}

export function draftViewsAfterPriceRename(): TableViewsData {
  const views = tableViews('Draft name');
  return {
    ...views,
    views: views.views.map((view) =>
      view.id === 'main'
        ? {
            ...view,
            columns: [
              { field: 'data.cost', width: 240 },
              { field: 'data.title', width: 100 },
            ],
            filters: {
              logic: 'or',
              conditions: [{ field: 'data.cost', operator: 'gte', value: 5 }],
              groups: [],
            },
          }
        : view,
    ),
  };
}

export function draftViewsAfterDiscardedPriceRename(): TableViewsData {
  const views = tableViews('Draft name');
  return {
    ...views,
    views: views.views.map((view) =>
      view.id === 'main'
        ? {
            ...view,
            columns: [
              { field: 'data.price', width: 240 },
              { field: 'data.title', width: 100 },
            ],
            filters: {
              logic: 'or',
              conditions: [{ field: 'data.price', operator: 'gte', value: 5 }],
              groups: [],
            },
          }
        : view,
    ),
  };
}

export function storedTableViews(
  state: DraftRevisionState,
  ownerTableId: string,
): TableViewsData | undefined {
  const viewsTable = state.tables.find(({ id }) => id === SystemTables.Views);
  const row = viewsTable?.rows.find(({ id }) => id === ownerTableId);
  return row?.data as unknown as TableViewsData | undefined;
}

export function requireStoredTableViews(
  state: DraftRevisionState,
  ownerTableId: string,
): TableViewsData {
  const result = storedTableViews(state, ownerTableId);
  if (!result) {
    throw new Error(`Expected stored views for table '${ownerTableId}'.`);
  }
  return result;
}

export function schemaHistoryMetadata(
  state: DraftRevisionState,
  tableId: string,
): unknown {
  const schemaTable = state.tables.find(({ id }) => id === SystemTables.Schema);
  const schemaRow = schemaTable?.rows.find(({ id }) => id === tableId);
  if (!schemaRow) {
    throw new Error(`Expected schema metadata for table '${tableId}'.`);
  }
  return schemaRow.meta;
}
