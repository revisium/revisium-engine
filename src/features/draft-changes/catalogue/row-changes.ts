import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { SnapshotRow } from './snapshot-pairs';

export function buildRowEntries(
  tableCreatedId: string,
  headTableId: string | undefined,
  draftTableId: string | undefined,
  pairs: Array<{ createdId: string; head?: SnapshotRow; draft?: SnapshotRow }>,
): DraftChangesCatalogueEntry[] {
  const entries: DraftChangesCatalogueEntry[] = [];
  for (const { createdId, head, draft } of pairs) {
    if (!head || !draft) {
      const entry = rowLifecycleEntry(
        tableCreatedId,
        createdId,
        headTableId,
        draftTableId,
        head,
        draft,
      );
      if (entry) {
        entries.push(entry);
      }
      continue;
    }
    if (head.id === draft.id) {
      continue;
    }
    entries.push(
      rowRenameEntry(tableCreatedId, createdId, draftTableId, head, draft),
    );
  }
  return entries;
}

function rowLifecycleEntry(
  tableCreatedId: string,
  rowCreatedId: string,
  headTableId: string | undefined,
  draftTableId: string | undefined,
  head: SnapshotRow | undefined,
  draft: SnapshotRow | undefined,
): DraftChangesCatalogueEntry | undefined {
  const current = draft ?? head;
  if (!current) {
    return undefined;
  }
  const created = Boolean(draft);
  return {
    ref: { value: '' },
    kind: 'row',
    target: {
      kind: 'row',
      tableCreatedId,
      rowCreatedId,
      tableId: created ? (draftTableId ?? '') : (headTableId ?? ''),
      rowId: current.id,
    },
    classification: created ? 'created' : 'deleted',
    path: '',
    before: created ? undefined : current.id,
    after: created ? current.id : undefined,
    beforeExists: !created,
    afterExists: created,
    selectable: true,
  };
}

function rowRenameEntry(
  tableCreatedId: string,
  rowCreatedId: string,
  tableId: string | undefined,
  head: SnapshotRow,
  draft: SnapshotRow,
): DraftChangesCatalogueEntry {
  return {
    ref: { value: '' },
    kind: 'row',
    target: {
      kind: 'row',
      tableCreatedId,
      rowCreatedId,
      tableId: tableId ?? '',
      rowId: draft.id,
    },
    classification: 'renamed',
    path: '',
    previousPath: head.id,
    before: head.id,
    after: draft.id,
    beforeExists: true,
    afterExists: true,
    selectable: true,
  };
}
