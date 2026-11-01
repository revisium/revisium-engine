import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { sql } from 'src/engine-prisma-types';
import type {
  PreviewChangesInput,
  PreviewChangesResult,
} from 'src/features/partial-changes/queries/impl/preview-draft-changes.query';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';

export type PreviewOptions = Omit<PreviewChangesInput, 'branch'>;

export interface TransactionMode {
  readonly readOnly: string;
  readonly isolation: string;
}

export function previewChanges(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  options: PreviewOptions,
): Promise<PreviewChangesResult> {
  return kit.partialChangesApi.previewChanges({ ...options, branch });
}

export async function transactionModeOfSnapshotRead(
  kit: PartialChangesTestKit,
  operation: () => Promise<unknown>,
): Promise<TransactionMode> {
  const reader = kit.snapshotReader;
  const readSnapshot = reader.readSnapshot.bind(reader);
  const modes: TransactionMode[] = [];
  const spy = jest
    .spyOn(reader, 'readSnapshot')
    .mockImplementation(async (branch) => {
      modes.push(await readTransactionMode(kit));

      return readSnapshot(branch);
    });

  try {
    await operation();
  } finally {
    spy.mockRestore();
  }

  const [mode] = modes;

  if (modes.length !== 1 || !mode) {
    throw new Error(`The operation read ${modes.length} snapshots, not one`);
  }

  return mode;
}

export function failingFirstSnapshotRead(
  kit: PartialChangesTestKit,
  failure: Error,
): jest.SpyInstance {
  return jest
    .spyOn(kit.snapshotReader, 'readSnapshot')
    .mockRejectedValueOnce(failure);
}

async function readTransactionMode(
  kit: PartialChangesTestKit,
): Promise<TransactionMode> {
  const [mode] = await kit.transactionService.getTransaction().$queryRaw<
    TransactionMode[]
  >(sql`
    SELECT current_setting('transaction_read_only') AS "readOnly",
           current_setting('transaction_isolation') AS "isolation"
  `);

  if (!mode) {
    throw new Error('The transaction mode was not read');
  }

  return mode;
}
