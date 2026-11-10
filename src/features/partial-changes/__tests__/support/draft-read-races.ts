import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { createBarrier } from 'src/__tests__/utils/barrier';
import { DraftTableItems } from 'src/features/partial-changes/draft-reads/draft-table-items';

// The table page waits at its barrier once it has read its snapshot and listed its tables, before their details.
export async function readTablePageWhileDraftChanges<T>(
  kit: PartialChangesTestKit,
  read: () => Promise<T>,
  edit: () => Promise<unknown>,
): Promise<T> {
  const items = kit.module.get(DraftTableItems);
  const edgesOf = items.edgesOf.bind(items);
  const barrier = createBarrier('A Draft table page');
  const hold = jest
    .spyOn(items, 'edgesOf')
    .mockImplementation(async (page, tables) => {
      await barrier.arrive();

      return edgesOf(page, tables);
    });

  try {
    const reading = read();

    await barrier.expectReachedBefore(reading);
    await edit();
    barrier.release();

    return await reading;
  } finally {
    barrier.release();
    hold.mockRestore();
  }
}
