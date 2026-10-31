import type { Migration } from '@revisium/schema-toolkit/types';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createBarrier } from 'src/__tests__/utils/barrier';

export async function applyMigrationWhileAnotherWriterCommits<T>(
  kit: DraftTestKit,
  { revisionId, migration }: { revisionId: string; migration: Migration },
  anotherWriter: () => Promise<T>,
) {
  const transaction = holdFirstWriterInsideTransaction(kit);

  try {
    const heldImport = kit.draftApiService.applyMigrations({
      revisionId,
      migrations: [migration],
    });
    await transaction.expectReachedBefore(heldImport);
    const anotherWrite = await anotherWriter().finally(transaction.release);

    return { held: await heldImport, another: anotherWrite };
  } finally {
    transaction.restore();
  }
}

function holdFirstWriterInsideTransaction(kit: DraftTestKit) {
  const commands = kit.draftTransactionalCommands;
  const resolveDraftRevision = commands.resolveDraftRevision.bind(commands);
  const barrier = createBarrier('The held migration import');
  let isFirstWriter = true;

  const spy = jest
    .spyOn(commands, 'resolveDraftRevision')
    .mockImplementation(async (revisionId) => {
      await resolveDraftRevision(revisionId);

      if (isFirstWriter) {
        isFirstWriter = false;
        await barrier.arrive();
      }
    });

  return {
    expectReachedBefore: barrier.expectReachedBefore,
    release: barrier.release,
    restore: () => spy.mockRestore(),
  };
}
