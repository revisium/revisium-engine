import type { Migration } from '@revisium/schema-toolkit/types';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';

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
    await transaction.reached;
    const anotherWrite = await anotherWriter().finally(transaction.release);

    return { held: await heldImport, another: anotherWrite };
  } finally {
    transaction.restore();
  }
}

function holdFirstWriterInsideTransaction(kit: DraftTestKit) {
  const commands = kit.draftTransactionalCommands;
  const resolveDraftRevision = commands.resolveDraftRevision.bind(commands);
  let isFirstWriter = true;
  let arrive!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  const spy = jest
    .spyOn(commands, 'resolveDraftRevision')
    .mockImplementation(async (revisionId) => {
      await resolveDraftRevision(revisionId);

      if (isFirstWriter) {
        isFirstWriter = false;
        arrive();
        await released;
      }
    });

  return {
    reached,
    release,
    restore: () => spy.mockRestore(),
  };
}
