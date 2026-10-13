import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenNativeTable,
  importNativeLedger,
  nativeSchema,
  readNativeLedger,
  readNativeTableCreation,
} from './support/native-migration-scenario';

describe('Native migration date exhaustion', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit({
      migrationOptions: { workerMode: 'disabled' },
    });
  });

  afterAll(async () => {
    await kit.close();
  });

  it('rolls back the table and schema when ordinary allocation exhausts the date range', async () => {
    const project = await givenNativeTable(kit, '9999-12-31T23:59:59.999Z');
    const before = await readNativeLedger(kit, project.draftRevisionId);

    await expect(
      kit.draftApiService.apiCreateTable({
        revisionId: project.draftRevisionId,
        tableId: 'unwritten',
        schema: nativeSchema,
      }),
    ).rejects.toMatchObject({
      name: 'RangeError',
      message:
        'Native migration history has exhausted the supported date range',
    });

    expect(await readNativeLedger(kit, project.draftRevisionId)).toEqual(
      before,
    );
    expect(
      await readNativeTableCreation(kit, project.draftRevisionId, 'unwritten'),
    ).toEqual({ table: null, schema: null });
  });

  it('uses the last available canonical millisecond after a year-9999 import', async () => {
    const project = await givenNativeTable(kit, '9999-12-31T23:59:59.998Z');

    await kit.draftApiService.apiCreateTable({
      revisionId: project.draftRevisionId,
      tableId: 'last',
      schema: nativeSchema,
    });

    const ledger = await readNativeLedger(kit, project.draftRevisionId);
    expect(ledger.at(-1)?.id).toBe('9999-12-31T23:59:59.999Z');
    await importNativeLedger(kit, ledger);
  });
});
