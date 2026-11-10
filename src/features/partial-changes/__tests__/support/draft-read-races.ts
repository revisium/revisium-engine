import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { type Barrier, createBarrier } from 'src/__tests__/utils/barrier';
import { DraftTableItems } from 'src/features/partial-changes/draft-reads/draft-table-items';
import { ReportedRowCountsReader } from 'src/features/partial-changes/draft-reads/reported-row-counts-reader';

// The table page waits at its barrier once it has read its snapshot and listed its tables, before their details.
export function readTablePageWhileDraftChanges<T>(
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

  return readWhileHeld(barrier, hold, read, edit);
}

// The summary waits at its barrier once it has read its snapshot, before it counts the rows of its first table.
export function readSummaryWhileDraftChanges<T>(
  kit: PartialChangesTestKit,
  read: () => Promise<T>,
  edit: () => Promise<unknown>,
): Promise<T> {
  const reader = kit.module.get(ReportedRowCountsReader);
  const readRowCounts = reader.readRowCounts.bind(reader);
  const barrier = createBarrier('A Draft summary');
  const hold = jest
    .spyOn(reader, 'readRowCounts')
    .mockImplementation(async (rows) => {
      await barrier.arrive();

      return readRowCounts(rows);
    });

  return readWhileHeld(barrier, hold, read, edit);
}

async function readWhileHeld<T>(
  barrier: Barrier,
  hold: jest.SpyInstance,
  read: () => Promise<T>,
  edit: () => Promise<unknown>,
): Promise<T> {
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
