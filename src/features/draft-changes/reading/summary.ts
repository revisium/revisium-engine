import type {
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { ReadDraftChangesResult } from 'src/features/draft-changes/queries/impl/read-draft-changes.query';

export function summarizeCatalogue(
  catalogue: DraftChangesCatalogue,
): ReadDraftChangesResult {
  const affectedTables = new Set<string>();
  const affectedRows = new Set<string>();
  let fields = 0;

  for (const entry of catalogue.entries) {
    affectedTables.add(entry.target.tableCreatedId);
    if (isRowEntry(entry)) {
      affectedRows.add(rowIdentity(entry));
    }
    if (entry.kind === 'schemaField' || entry.kind === 'rowField') {
      fields += 1;
    }
  }

  return {
    isEmpty: catalogue.entries.length === 0,
    counts: {
      tables: affectedTables.size,
      rows: affectedRows.size,
      fields,
    },
  };
}

export function isRowEntry(entry: DraftChangesCatalogueEntry): boolean {
  return entry.kind === 'row' || entry.kind === 'rowField';
}

export function rowIdentity(entry: DraftChangesCatalogueEntry): string {
  if (entry.target.kind !== 'row' && entry.target.kind !== 'rowField') {
    throw new Error('Expected a row catalogue entry.');
  }
  return `${entry.target.tableCreatedId}\u0000${entry.target.rowCreatedId}`;
}
