import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import {
  draftWriters,
  givenDraftWithFileRow,
  readDraftContent,
} from './support/draft-writers';
import { writeWhileMigrationStarts } from './support/writer-migration-race';

describe('Draft API writers under the migration lock', () => {
  it.each(draftWriters)(
    '$name refuses when a migration starts before its transaction and writes nothing',
    async ({ write }) => {
      const draft = await givenDraftWithFileRow(kit);
      const contentBefore = await readDraftContent(kit, draft.draftRevisionId);

      await expect(
        writeWhileMigrationStarts(kit, draft, () => write(kit, draft)),
      ).rejects.toThrow(MigrationLockedException);

      await expect(
        readDraftContent(kit, draft.draftRevisionId),
      ).resolves.toEqual(contentBefore);
    },
  );

  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit({
      migrationOptions: { workerMode: 'disabled' },
    });
  });

  afterAll(async () => {
    await kit.close();
  });
});
