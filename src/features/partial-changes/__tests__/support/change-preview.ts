import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { blockEventLoopFor } from 'src/__tests__/utils/event-loop';
import { sql } from 'src/engine-prisma-types';
import { RowReferenceChecks } from 'src/features/partial-changes/closure/row-reference-checks';
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

export function passingTheDeadlineAfterValidation(
  kit: PartialChangesTestKit,
  durationMs: number,
): jest.SpyInstance {
  const validator = kit.targetValidator;
  const validate = validator.validate.bind(validator);

  return jest
    .spyOn(validator, 'validate')
    .mockImplementation(async (source, validated) => {
      const blockers = await validate(source, validated);

      blockEventLoopFor(durationMs);

      return blockers;
    });
}

export function passingTheDeadlineAfterRowChecks(
  kit: PartialChangesTestKit,
  durationMs: number,
): jest.SpyInstance {
  const checks = kit.module.get(RowReferenceChecks);
  const checkingOf = checks.checkingOf.bind(checks);

  return jest.spyOn(checks, 'checkingOf').mockImplementation((source) => {
    const checking = checkingOf(source);

    return {
      async findingsOf(target, choice) {
        const findings = await checking.findingsOf(target, choice);

        blockEventLoopFor(durationMs);

        return findings;
      },
    };
  });
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
