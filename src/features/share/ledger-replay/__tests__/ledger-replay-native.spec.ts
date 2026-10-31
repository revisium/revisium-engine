import type { JsonSchema } from '@revisium/schema-toolkit/types';
import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import { replayLedger } from 'src/features/share/ledger-replay/ledger-replay';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import { givenDraftAfterRandomTableOperations } from './support/random-table-operations';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const OPERATIONS_PER_SEQUENCE = 30;

describe('ledger replay of native table operations', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit({
      migrationOptions: { workerMode: 'disabled' },
    });
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(SEEDS)(
    'replays the Draft ledger from empty to the Draft schemas (seed %i)',
    async (seed) => {
      const draft = await givenDraftAfterRandomTableOperations(kit, {
        seed,
        operations: OPERATIONS_PER_SEQUENCE,
      });

      const replay = replayLedger({
        ledger: await draft.readLedger(),
        refs: draft.refs,
      });

      expect(Object.fromEntries(replay.unreplayable)).toEqual({});
      expect(
        schemaMismatches(replay.schemas, await draft.readSchemas()),
      ).toEqual([]);
    },
  );
});

function schemaMismatches(
  replayed: ReadonlyMap<string, JsonSchema>,
  stored: ReadonlyMap<string, JsonSchema>,
) {
  const tableIds = new Set([...replayed.keys(), ...stored.keys()]);

  return [...tableIds]
    .map((tableId) => ({
      tableId,
      replayed: replayed.get(tableId),
      stored: stored.get(tableId),
    }))
    .filter(
      ({ replayed: replayedSchema, stored: storedSchema }) =>
        !replayedSchema ||
        !storedSchema ||
        !schemasEqual(replayedSchema, storedSchema),
    );
}
