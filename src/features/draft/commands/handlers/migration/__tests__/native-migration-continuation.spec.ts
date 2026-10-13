import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import { givenContinuedNativeHistory } from './support/native-continuation-scenario';

describe('Native continuation after future history', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit({
      migrationOptions: { workerMode: 'disabled' },
    });
  });

  afterAll(async () => {
    await kit.close();
  });

  it('preserves the committed Head prefix', async () => {
    const scenario = await givenContinuedNativeHistory(kit);

    expect(await scenario.readHead()).toEqual(scenario.headPrefix);
  });

  it('appends ordinary writes after the installed Draft prefix', async () => {
    const scenario = await givenContinuedNativeHistory(kit);

    const ledger = await scenario.readDraft();

    expect(ledger.slice(0, scenario.installedPrefix.length)).toEqual(
      scenario.installedPrefix,
    );
    expect(ledger.map(({ changeType }) => changeType)).toEqual([
      'init',
      'rename',
      'update',
      'rename',
    ]);
  });

  it('replays ordinary continuation in a fresh native import', async () => {
    const scenario = await givenContinuedNativeHistory(kit);

    const replay = await scenario.freshImport();

    expect(await replay.readLedger()).toEqual(scenario.ledger);
  });

  it('skips a repeated continuation payload without changing its ledger', async () => {
    const scenario = await givenContinuedNativeHistory(kit);
    const replay = await scenario.freshImport();

    const results = await replay.reimport();

    expect(results).toEqual(
      scenario.ledger.map(({ id }) => ({ id, status: 'skipped' })),
    );
    expect(await replay.readLedger()).toEqual(scenario.ledger);
  });
});
