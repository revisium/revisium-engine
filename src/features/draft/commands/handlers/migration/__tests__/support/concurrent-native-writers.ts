import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { CreateInitMigrationHandler } from '../../create-init-migration.handler';
import { nativeSchema } from './native-migration-scenario';

const WRITER_COUNT = 2;

function allocationBarrier() {
  let arrivals = 0;
  let release!: () => void;
  const bothArrived = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrivals++;
    if (arrivals === WRITER_COUNT) {
      release();
    }
    await bothArrived;
  };
}

export async function runConcurrentNativeWriters(
  kit: DraftTestKit,
  revisionId: string,
) {
  const waitForBothAllocations = allocationBarrier();
  const observedBounds: (string | null)[] = [];
  const handler = kit.module.get(CreateInitMigrationHandler);
  const allocationReader = handler as unknown as {
    readMigrationBounds(revisionId: string): Promise<{
      id: string | null;
      publishedAt: Date | null;
    }>;
  };
  const readBounds = allocationReader.readMigrationBounds.bind(handler);
  const allocation = jest
    .spyOn(allocationReader, 'readMigrationBounds')
    .mockImplementation(async (id) => {
      const bounds = await readBounds(id);
      observedBounds.push(bounds.id);
      await waitForBothAllocations();
      return bounds;
    });

  try {
    const results = await Promise.allSettled(
      ['first', 'second'].map((tableId) =>
        kit.draftApiService.apiCreateTable({
          revisionId,
          tableId,
          schema: nativeSchema,
        }),
      ),
    );
    return { results, observedBounds };
  } finally {
    allocation.mockRestore();
  }
}
