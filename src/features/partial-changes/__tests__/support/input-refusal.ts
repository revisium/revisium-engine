import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { SelectionValidationError } from 'src/features/partial-changes/selection/selection-validator';

export async function expectRefusedBeforeAnyTransaction(
  kit: PartialChangesTestKit,
  operation: () => Promise<unknown>,
): Promise<void> {
  const transactions = jest.spyOn(kit.prisma, '$transaction');
  const snapshotReads = jest.spyOn(kit.snapshotReader, 'readSnapshot');

  await expect(operation()).rejects.toThrow(SelectionValidationError);
  expect(transactions).not.toHaveBeenCalled();
  expect(snapshotReads).not.toHaveBeenCalled();
}
