import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { TablePair } from './snapshot-pairs';

export function buildTableEntries(
  pair: TablePair,
): DraftChangesCatalogueEntry[] {
  const { head, draft, createdId } = pair;
  if (!head || !draft) {
    const current = draft ?? head;
    if (!current) {
      return [];
    }
    const created = Boolean(draft);
    return [
      {
        ref: { value: '' },
        kind: 'table',
        target: {
          kind: 'table',
          tableCreatedId: createdId,
          tableId: current.id,
        },
        classification: created ? 'created' : 'deleted',
        path: '',
        before: created ? undefined : head?.id,
        after: created ? draft?.id : undefined,
        beforeExists: !created,
        afterExists: created,
        selectable: true,
      },
    ];
  }
  if (head.id === draft.id) {
    return [];
  }
  return [
    {
      ref: { value: '' },
      kind: 'table',
      target: { kind: 'table', tableCreatedId: createdId, tableId: draft.id },
      classification: 'renamed',
      path: '',
      previousPath: head.id,
      before: head.id,
      after: draft.id,
      beforeExists: true,
      afterExists: true,
      selectable: true,
    },
  ];
}
