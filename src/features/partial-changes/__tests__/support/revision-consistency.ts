import { storedSchemasOf } from 'src/__tests__/fixtures/stored-ledger';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import type { ChangesScenario } from './changes-scenario';
import { replayedSchemasOf } from './ledger-replaying';
import type { RevisionSide } from './snapshot-reading';

const SIDES: readonly RevisionSide[] = ['head', 'draft'];

// Each side links a schema row for exactly its user tables and its ledger replays to them; the Draft's hasChanges is
// what the native diff against Head sees.
export async function expectConsistentRevisions(
  draft: ChangesScenario,
): Promise<void> {
  for (const side of SIDES) {
    const schemas = await storedSchemasOf(draft, side);
    const tables = await draft.userTables(side);

    expect(Object.keys(schemas).sort(compareCodePoints)).toEqual(
      tables.map(({ id }) => id),
    );
    expect(await replayedSchemasOf(draft, side)).toEqual(schemas);
  }

  const nativeDiff = await draft.readNativeSummary();
  expect(await draft.hasChanges()).toBe(nativeDiff.totalChanges > 0);
}
