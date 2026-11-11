import type { TableViewsData } from 'src/features/views/types';

// A views document whose default view shows the given data fields.
export function tableViews(
  name: string,
  fields: readonly string[],
): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'default',
    views: [
      {
        id: 'default',
        name,
        columns: fields.map((field) => ({ field: `data.${field}` })),
      },
    ],
  };
}
