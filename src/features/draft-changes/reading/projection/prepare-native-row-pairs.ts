import type { JsonValue } from '@revisium/schema-toolkit/types';
import {
  pairSnapshotRows,
  type SnapshotRow,
} from 'src/features/draft-changes/catalogue/snapshot-pairs';

export interface NativeRowPair {
  createdId: string;
  head: SnapshotRow;
  draft: SnapshotRow;
}

export function prepareNativeRowPairs({
  tableCreatedId,
  headRows,
  draftRows,
  migratedHeadRows,
}: {
  tableCreatedId: string;
  headRows: SnapshotRow[];
  draftRows: SnapshotRow[];
  migratedHeadRows: Array<{ createdId: string; data: JsonValue }>;
}): NativeRowPair[] {
  const pairedRows = pairSnapshotRows(tableCreatedId, headRows, draftRows);
  if ('blocker' in pairedRows) {
    throw new Error(pairedRows.blocker);
  }

  const migratedRows = uniqueMigratedRows(migratedHeadRows);
  const nativeRows: NativeRowPair[] = [];
  for (const row of pairedRows.pairs) {
    if (!row.head || !row.draft) {
      continue;
    }
    const migratedData = migratedRows.get(row.createdId);
    if (migratedData === undefined) {
      throw new Error(
        `Full migrated Head projection is missing shared row '${row.createdId}'.`,
      );
    }
    nativeRows.push({
      createdId: row.createdId,
      head: structuredClone({ ...row.head, data: migratedData }),
      draft: structuredClone(row.draft),
    });
  }
  return nativeRows;
}

function uniqueMigratedRows(
  rows: Array<{ createdId: string; data: JsonValue }>,
): Map<string, JsonValue> {
  const result = new Map<string, JsonValue>();
  for (const row of rows) {
    if (result.has(row.createdId)) {
      throw new Error(
        `Full migrated Head projection contains duplicate row '${row.createdId}'.`,
      );
    }
    result.set(row.createdId, row.data);
  }
  return result;
}
