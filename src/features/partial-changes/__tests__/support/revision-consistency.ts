import { storedSchemasOf } from 'src/__tests__/fixtures/stored-ledger';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { ChangesScenario } from './changes-scenario';
import { replayedSchemasOf } from './ledger-replaying';
import type { RevisionSide } from './snapshot-reading';

const SIDES: readonly RevisionSide[] = ['head', 'draft'];

// Each side links one schema row for each of its user tables, each table id once, and its ledger replays to those
// schemas; the Draft's hasChanges is what the native diff against Head sees.
export async function expectConsistentRevisions(
  draft: ChangesScenario,
): Promise<void> {
  for (const side of SIDES) {
    const schemaRowIds = await schemaRowIdsOf(draft, side);
    const tableIds = await userTableIdsOf(draft, side);

    expect({ side, duplicates: duplicatesOf(schemaRowIds) }).toEqual({
      side,
      duplicates: [],
    });
    expect({ side, duplicates: duplicatesOf(tableIds) }).toEqual({
      side,
      duplicates: [],
    });
    expect(schemaRowIds).toEqual(tableIds);
    expect(await replayedSchemasOf(draft, side)).toEqual(
      await storedSchemasOf(draft, side),
    );
  }

  const nativeDiff = await draft.readNativeSummary();
  expect(await draft.hasChanges()).toBe(nativeDiff.totalChanges > 0);
}

async function schemaRowIdsOf(
  draft: ChangesScenario,
  side: RevisionSide,
): Promise<string[]> {
  const rows = await draft.rows(side, SystemTables.Schema);

  return rows.map(({ id }) => id);
}

async function userTableIdsOf(
  draft: ChangesScenario,
  side: RevisionSide,
): Promise<string[]> {
  const tables = await draft.userTables(side);

  return tables.map(({ id }) => id);
}

function duplicatesOf(ids: readonly string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) !== index);
}
