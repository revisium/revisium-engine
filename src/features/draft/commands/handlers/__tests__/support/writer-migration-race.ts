import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  getNumberSchema,
  getObjectSchema,
  getRefSchema,
} from '@revisium/schema-toolkit/mocks';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  givenDraftProjectWithSchema,
  type DraftProjectScenario,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createBarrier } from 'src/__tests__/utils/barrier';
import { createPreviousFile } from 'src/__tests__/utils/prepareProject';
import { createMigrationRecord } from 'src/features/migration/__tests__/support/migration-database';
import { MigrationStatus } from 'src/features/migration/types/migration.types';

export interface DraftWithFileRow extends DraftProjectScenario {
  file: ReturnType<typeof createPreviousFile>;
}

const fileRowSchema = getObjectSchema({
  ver: getNumberSchema(),
  file: getRefSchema(SystemSchemaIds.File),
});

export async function givenDraftWithFileRow(
  kit: DraftTestKit,
): Promise<DraftWithFileRow> {
  const file = createPreviousFile();
  const draft = await givenDraftProjectWithSchema({
    prismaService: kit.prismaService,
    schema: fileRowSchema,
    row: { data: { ver: 1, file } },
  });

  return { ...draft, file };
}

export async function writeWhileMigrationStarts<T>(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
  write: () => Promise<T>,
): Promise<T> {
  const transaction = holdWriterBeforeItsTransaction(kit);
  const writing = write();
  const writingSettled = Promise.allSettled([writing]);

  try {
    await transaction.expectReachedBefore(writing);
    await startMigration(kit, draft);
  } finally {
    transaction.release();
    await writingSettled;
    transaction.restore();
  }

  return writing;
}

export function readDraftContent(kit: DraftTestKit, revisionId: string) {
  return kit.prismaService.revision.findUniqueOrThrow({
    where: { id: revisionId },
    select: {
      isDraft: true,
      isHead: true,
      hasChanges: true,
      tables: {
        orderBy: { versionId: 'asc' },
        select: {
          id: true,
          versionId: true,
          rows: {
            orderBy: { versionId: 'asc' },
            select: { id: true, versionId: true, data: true },
          },
        },
      },
    },
  });
}

async function startMigration(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
): Promise<void> {
  await createMigrationRecord(
    kit.prismaService,
    draft.draftRevisionId,
    MigrationStatus.COPYING,
    { tableId: draft.tableId },
  );
}

function holdWriterBeforeItsTransaction(kit: DraftTestKit) {
  const barrier = createBarrier('The writer');
  const transactionService = kit.transactionService;
  const runSerializable =
    transactionService.runSerializable.bind(transactionService);
  let isFirstTransaction = true;

  const spy = jest
    .spyOn(transactionService, 'runSerializable')
    .mockImplementation(async (handler, options) => {
      if (isFirstTransaction) {
        isFirstTransaction = false;
        await barrier.arrive();
      }

      return runSerializable(handler, options);
    });

  return {
    expectReachedBefore: barrier.expectReachedBefore,
    release: barrier.release,
    restore: () => spy.mockRestore(),
  };
}
