import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import {
  freezeNativeClock,
  givenNativeTable,
  importNativeLedger,
  nativeSchema,
  nativeWriters,
  readNativeLedger,
} from './support/native-migration-scenario';

describe('Native migration ID order', () => {
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

  describe.each([
    '2099-01-01T00:00:00.000Z',
    '2099-01-01T00:00:00Z',
    '2099-01-01T00:00:00+05:00',
    '2099-01-01T00:00:00-05:00',
    '2099-01-01t00:00:00z',
    '2099-01-01 00:00:00Z',
    '2099-01-01T00:00:00.5Z',
    '2099-01-01T00:00:00.000123Z',
  ])('after imported %s', (id) => {
    it.each(nativeWriters)(
      'appends the ordinary $name writer in native export order',
      async ({ name, write }) => {
        const project = await givenNativeTable(kit, id);
        const prefix = await readNativeLedger(kit, project.draftRevisionId);

        await write(kit, project.draftRevisionId);

        const ledger = await readNativeLedger(kit, project.draftRevisionId);
        expect(ledger.slice(0, prefix.length)).toEqual(prefix);
        expect(ledger.at(-1)?.changeType).toBe(name);
        expect(Date.parse(ledger.at(-1)?.id ?? '')).toBeGreaterThan(
          Date.parse(id),
        );
        const replay = await importNativeLedger(kit, ledger);
        expect(await readNativeLedger(kit, replay.draftRevisionId)).toEqual(
          ledger,
        );
      },
    );
  });

  it('assigns distinct appended IDs to ordinary writes at the same clock instant', async () => {
    const project = await givenNativeTable(kit, '2099-01-01T00:00:00.000Z');
    freezeNativeClock('2099-01-01T00:00:01.000Z');

    await kit.draftApiService.apiCreateTable({
      revisionId: project.draftRevisionId,
      tableId: 'first',
      schema: nativeSchema,
    });
    await kit.draftApiService.apiCreateTable({
      revisionId: project.draftRevisionId,
      tableId: 'second',
      schema: nativeSchema,
    });

    const ledger = await readNativeLedger(kit, project.draftRevisionId);
    expect(ledger.map(({ tableId }) => tableId)).toEqual([
      'products',
      'first',
      'second',
    ]);
    expect(new Set(ledger.map(({ id }) => id)).size).toBe(3);
    await importNativeLedger(kit, ledger);
  });

  it('uses the clock for an empty target ledger despite unrelated future history', async () => {
    await givenNativeTable(kit, '2200-01-01T00:00:00.000Z');
    const project = await importNativeLedger(kit, []);
    const now = '2026-10-13T12:00:00.000Z';
    freezeNativeClock(now);

    await kit.draftApiService.apiCreateTable({
      revisionId: project.draftRevisionId,
      tableId: 'first',
      schema: nativeSchema,
    });

    expect(
      (await readNativeLedger(kit, project.draftRevisionId)).map(
        ({ id }) => id,
      ),
    ).toEqual([now]);
  });
});
