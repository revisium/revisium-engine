import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { Row } from 'src/engine-prisma-types';
import type { StoredTable } from 'src/features/share/branch-revisions/branch-revision-reader';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import type { BackfillRevision, BackfillState } from './backfill-state-reader';

export function draftStructureChangesOf({
  head,
  draft,
}: BackfillState): string[] {
  if (draft.hasMigrationTable) {
    return [SystemTables.Migration];
  }

  const headTables = tablesByCreatedId(head);
  const draftTables = tablesByCreatedId(draft);
  const changed = new Set<string>();

  for (const [createdId, headTable] of headTables) {
    const changedId = changedTableIdOf(
      { revision: head, table: headTable },
      { revision: draft, table: draftTables.get(createdId) },
    );

    if (changedId !== undefined) {
      changed.add(changedId);
    }
  }

  for (const [createdId, draftTable] of draftTables) {
    if (!headTables.has(createdId)) {
      changed.add(draftTable.id);
    }
  }

  return [...changed].sort(compareCodePoints);
}

interface SideTable<Table extends StoredTable | undefined> {
  readonly revision: BackfillRevision;
  readonly table: Table;
}

function changedTableIdOf(
  head: SideTable<StoredTable>,
  draft: SideTable<StoredTable | undefined>,
): string | undefined {
  if (!draft.table) {
    return head.table.id;
  }

  if (
    draft.table.id !== head.table.id ||
    !sameSchemaRows(schemaRowOf(head), schemaRowOf(draft))
  ) {
    return draft.table.id;
  }

  return undefined;
}

function tablesByCreatedId({
  userTables,
}: BackfillRevision): Map<string, StoredTable> {
  return new Map(userTables.map((table) => [table.createdId, table]));
}

function schemaRowOf({
  revision,
  table,
}: SideTable<StoredTable | undefined>): Row | undefined {
  return table && revision.schemaRows.get(table.id);
}

function sameSchemaRows(
  headRow: Row | undefined,
  draftRow: Row | undefined,
): boolean {
  if (!headRow || !draftRow) {
    return headRow === draftRow;
  }

  return (
    deepEqual(headRow.data, draftRow.data) &&
    deepEqual(headRow.meta, draftRow.meta)
  );
}
