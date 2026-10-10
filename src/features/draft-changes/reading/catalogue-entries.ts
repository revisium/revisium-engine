import type {
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';

export function entriesForTable(
  catalogue: DraftChangesCatalogue,
  tableCreatedId: string,
): DraftChangesCatalogueEntry[] {
  return catalogue.entries.filter(
    ({ target }) => target.tableCreatedId === tableCreatedId,
  );
}

export function groupEntriesByTable(
  entries: DraftChangesCatalogueEntry[],
): Map<string, DraftChangesCatalogueEntry[]> {
  const grouped = new Map<string, DraftChangesCatalogueEntry[]>();
  for (const entry of entries) {
    const tableEntries = grouped.get(entry.target.tableCreatedId) ?? [];
    tableEntries.push(entry);
    grouped.set(entry.target.tableCreatedId, tableEntries);
  }
  return grouped;
}

export function groupRowEntries(
  entries: DraftChangesCatalogueEntry[],
  tableCreatedId: string,
): Map<string, DraftChangesCatalogueEntry[]> {
  const grouped = new Map<string, DraftChangesCatalogueEntry[]>();
  for (const entry of entries) {
    if (
      (entry.kind !== 'row' && entry.kind !== 'rowField') ||
      (entry.target.kind !== 'row' && entry.target.kind !== 'rowField') ||
      entry.target.tableCreatedId !== tableCreatedId
    ) {
      continue;
    }
    const rowEntries = grouped.get(entry.target.rowCreatedId) ?? [];
    rowEntries.push(entry);
    grouped.set(entry.target.rowCreatedId, rowEntries);
  }
  return grouped;
}

export function entriesForRow(
  catalogue: DraftChangesCatalogue,
  tableCreatedId: string,
  rowCreatedId: string,
): DraftChangesCatalogueEntry[] {
  return catalogue.entries.filter(
    ({ kind, target }) =>
      (kind === 'row' || kind === 'rowField') &&
      target.tableCreatedId === tableCreatedId &&
      (target.kind === 'row' || target.kind === 'rowField') &&
      target.rowCreatedId === rowCreatedId,
  );
}

export function changedRowCreatedIds(
  entries: DraftChangesCatalogueEntry[],
): Set<string> {
  return new Set(
    entries.flatMap(({ kind, target }) =>
      (kind === 'row' || kind === 'rowField') &&
      (target.kind === 'row' || target.kind === 'rowField')
        ? [target.rowCreatedId]
        : [],
    ),
  );
}
