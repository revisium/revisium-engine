import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangeLeaf } from 'src/features/draft-changes/reading/leaf-types';

export function mapCatalogueLeaves(
  entries: DraftChangesCatalogueEntry[],
): DraftChangeLeaf[] {
  return entries.map(mapCatalogueLeaf);
}

export function mapCatalogueLeaf(
  entry: DraftChangesCatalogueEntry,
): DraftChangeLeaf {
  const { target } = entry;
  const rowId =
    target.kind === 'row' || target.kind === 'rowField'
      ? target.rowId
      : undefined;
  const path = entry.path;
  return {
    ref: entry.ref,
    kind: entry.classification,
    label: leafLabel(entry),
    selectable: entry.selectable,
    effect: {
      ...(entry.classification === 'created'
        ? { target: 'draft' as const }
        : {}),
      ...(entry.classification === 'deleted'
        ? { target: 'head' as const }
        : {}),
      tableId: target.tableId,
      ...(rowId ? { rowId } : {}),
      ...(path !== undefined ? { path } : {}),
      change: entry.classification,
      before: entry.before,
      after: entry.after,
      beforeExists: entry.beforeExists,
      afterExists: entry.afterExists,
    },
  };
}

function leafLabel(entry: DraftChangesCatalogueEntry): string {
  if (entry.path) {
    return entry.path;
  }
  switch (entry.target.kind) {
    case 'table':
      return entry.target.tableId;
    case 'row':
      return entry.target.rowId;
    case 'rowField':
      return entry.target.path;
    case 'schemaField':
      return entry.target.path;
    case 'view':
      return `${entry.target.viewId}.${entry.target.component}`;
    case 'viewConfiguration':
      return `views.${entry.target.component}`;
  }
}
