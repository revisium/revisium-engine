import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import { runConcurrentNativeWriters } from './support/concurrent-native-writers';
import {
  freezeNativeClock,
  givenNativeTable,
  importNativeLedger,
  readNativeLedger,
} from './support/native-migration-scenario';

describe('Concurrent native migration writers', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit({
      migrationOptions: { workerMode: 'disabled' },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('retries a real Serializable conflict and commits both writes with distinct appended IDs', async () => {
    const prefixId = '2099-01-01T00:00:00.000Z';
    const project = await givenNativeTable(kit, prefixId);
    freezeNativeClock('2099-01-01T00:00:01.000Z');

    const { results, observedBounds } = await runConcurrentNativeWriters(
      kit,
      project.draftRevisionId,
    );

    expect(results.map(({ status }) => status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    expect(observedBounds.slice(0, 2)).toEqual([prefixId, prefixId]);
    expect(observedBounds.length).toBeGreaterThan(2);
    expect(observedBounds[2]).toBe('2099-01-01T00:00:01.000Z');
    const ledger = await readNativeLedger(kit, project.draftRevisionId);
    expect(ledger[0]?.id).toBe(prefixId);
    expect(new Set(ledger.slice(1).map(({ tableId }) => tableId))).toEqual(
      new Set(['first', 'second']),
    );
    expect(new Set(ledger.map(({ id }) => id)).size).toBe(3);
    await importNativeLedger(kit, ledger);
  });
});
