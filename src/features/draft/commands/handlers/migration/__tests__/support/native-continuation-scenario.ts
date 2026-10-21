import { getStringSchema } from '@revisium/schema-toolkit/mocks';
import type { Migration } from '@revisium/schema-toolkit/types';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  commitNativeHistory,
  givenNativeTable,
  importNativeLedger,
  readNativeLedger,
} from './native-migration-scenario';

export async function givenContinuedNativeHistory(kit: DraftTestKit) {
  const project = await givenNativeTable(kit, '2099-01-01T00:00:00.000Z');
  const { headRevisionId, draftRevisionId } = await commitNativeHistory(
    kit,
    project,
  );
  const headPrefix = await readNativeLedger(kit, headRevisionId);
  await importPrerequisiteRename(kit, draftRevisionId);
  const installedPrefix = await readNativeLedger(kit, draftRevisionId);
  await continueNativeHistory(kit, draftRevisionId);
  const ledger = await readNativeLedger(kit, draftRevisionId);

  return {
    headPrefix,
    installedPrefix,
    ledger,
    readHead: () => readNativeLedger(kit, headRevisionId),
    readDraft: () => readNativeLedger(kit, draftRevisionId),
    freshImport: () => importContinuation(kit, ledger),
  };
}

function importPrerequisiteRename(kit: DraftTestKit, revisionId: string) {
  return kit.draftApiService.applyMigrations({
    revisionId,
    migrations: [
      {
        id: '2099-01-01T00:00:10.000Z',
        changeType: 'rename',
        tableId: 'products',
        nextTableId: 'assembled-products',
      },
    ],
  });
}

async function continueNativeHistory(kit: DraftTestKit, revisionId: string) {
  await kit.draftApiService.apiUpdateTable({
    revisionId,
    tableId: 'assembled-products',
    patches: [
      { op: 'add', path: '/properties/extra', value: getStringSchema() },
    ],
  });
  await kit.draftApiService.apiRenameTable({
    revisionId,
    tableId: 'assembled-products',
    nextTableId: 'continued-products',
  });
}

async function importContinuation(kit: DraftTestKit, migrations: Migration[]) {
  const project = await importNativeLedger(kit, migrations);
  return {
    readLedger: () => readNativeLedger(kit, project.draftRevisionId),
    reimport: () =>
      kit.draftApiService.applyMigrations({
        revisionId: project.draftRevisionId,
        migrations,
      }),
  };
}
