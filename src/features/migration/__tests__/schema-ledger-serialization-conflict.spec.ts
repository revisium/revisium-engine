import { HttpStatus, Logger } from '@nestjs/common';
import { BranchScenario } from 'src/__tests__/fixtures/branch-scenario';
import {
  type BranchScenarioTestKit,
  createBranchScenarioTestKit,
} from 'src/__tests__/kit/create-branch-scenario-test-kit';
import { serializationFailure } from 'src/features/draft-revision/services/__tests__/support/revision-lookup-test-kit';
import { LedgerBackfillPlanService } from 'src/features/migration/ledger-backfill/ledger-backfill-plan.service';
import { LEDGER_OPERATION_FINISHED } from 'src/features/migration/ledger-operation-log';
import { RepairWriter } from 'src/features/migration/ledger-repair/repair-writer';
import { isSerializationFailure } from 'src/infrastructure/database/database-errors';
import type { OperationLogEntry } from 'src/infrastructure/database/operation-log';
import { SerializationConflictException } from 'src/infrastructure/database/serialization-conflict.exception';
import {
  backfillLedger,
  backfillWhileNativeWriteLands,
  migrationTableOf,
} from './support/ledger-backfill';
import {
  CATEGORIES,
  categories,
  givenUnpublishedInPlaceMigration,
  PRODUCTS,
  products,
} from './support/ledger-damage';
import { repairLedger } from './support/ledger-repair-writing';

// One backfill attempt; two attempts of the repair's write, which follows the native retry setting.
const SPENT_ATTEMPT_SETTINGS = {
  PARTIAL_CHANGES_MAX_ATTEMPTS: '1',
  TRANSACTION_MAX_RETRIES: '2',
  TRANSACTION_BASE_DELAY_MS: '1',
  TRANSACTION_MAX_DELAY_MS: '10',
};

describe('Schema ledger operations whose attempts are spent', () => {
  describe('the backfill', () => {
    it('that loses its last attempt to a native write fails with SERIALIZATION_CONFLICT (409), keeping the database error as its cause, and writes nothing', async () => {
      const draft = await givenCatalogWithoutLedger();

      const failure = await failureOf(
        backfillWhileNativeWriteLands(kit, draft, () =>
          draft.updateRow(CATEGORIES, 'c1', { title: 'landed' }),
        ),
      );

      expectSerializationConflict(failure);
      expect(isSerializationFailure(failure.cause)).toBe(true);
      expect(await migrationTableOf(kit, draft, 'head')).toBeNull();
      expect(await migrationTableOf(kit, draft, 'draft')).toBeNull();
    });

    it('logs the failure with the code SERIALIZATION_CONFLICT and the attempt it made', async () => {
      const draft = await givenCatalogWithoutLedger();
      const entries = loggedEntries();

      await failureOf(
        backfillWhileNativeWriteLands(kit, draft, () =>
          draft.updateRow(CATEGORIES, 'c1', { title: 'landed' }),
        ),
      );

      expect(entries.failed()).toMatchObject([
        {
          operation: 'backfill',
          outcome: 'error',
          attempts: 1,
          error: 'SerializationConflictException',
          errorCode: 'SERIALIZATION_CONFLICT',
        },
      ]);
    });

    it('keeps a failure that is not a serialization failure as it is', async () => {
      const draft = await givenCatalogWithoutLedger();
      const failure = new Error('Planning failed');
      jest
        .spyOn(kit.module.get(LedgerBackfillPlanService), 'plan')
        .mockImplementation(() => {
          throw failure;
        });

      await expect(backfillLedger(kit, draft)).rejects.toBe(failure);
    });
  });

  describe('the repair', () => {
    it('whose write fails serialization on every attempt fails with SERIALIZATION_CONFLICT (409), keeping the last failure as its cause', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      const failures = failRepairWrites(kit, Number.POSITIVE_INFINITY);

      const failure = await failureOf(repairLedger(kit, draft));

      expectSerializationConflict(failure);
      expect(failure.cause).toBe(failures.last());
      expect(failures.count()).toBe(2);
    });

    it('logs the failure with the code SERIALIZATION_CONFLICT, counting the planning and both write attempts', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      failRepairWrites(kit, Number.POSITIVE_INFINITY);
      const entries = loggedEntries();

      await failureOf(repairLedger(kit, draft));

      expect(entries.failed()).toMatchObject([
        {
          operation: 'repair',
          outcome: 'error',
          attempts: 3,
          error: 'SerializationConflictException',
          errorCode: 'SERIALIZATION_CONFLICT',
        },
      ]);
    });

    it('whose write fails serialization once repairs on the next attempt', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      failRepairWrites(kit, 1);

      const repair = await repairLedger(kit, draft);

      expect(repair.tables).toMatchObject([
        { tableId: PRODUCTS, outcome: 'repaired' },
      ]);
    });

    it('keeps a failure of its write that is not a serialization failure as it is', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      const failure = new Error('Repair write failed');
      jest
        .spyOn(kit.module.get(RepairWriter), 'record')
        .mockRejectedValue(failure);

      await expect(repairLedger(kit, draft)).rejects.toBe(failure);
    });
  });

  let kit: BranchScenarioTestKit;

  beforeAll(async () => {
    kit = await createBranchScenarioTestKit({
      settings: SPENT_ATTEMPT_SETTINGS,
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  function givenCatalogWithoutLedger(): Promise<BranchScenario> {
    return BranchScenario.committedWithoutLedger(kit, {
      [CATEGORIES]: categories,
      [PRODUCTS]: products,
    });
  }
});

// The repair's write fails serialization inside its transaction on its first `times` attempts.
function failRepairWrites(kit: BranchScenarioTestKit, times: number) {
  const writer = kit.module.get(RepairWriter);
  const record = writer.record.bind(writer);
  const failures: Error[] = [];

  jest.spyOn(writer, 'record').mockImplementation((planned) => {
    if (failures.length >= times) {
      return record(planned);
    }

    const failure = serializationFailure();
    failures.push(failure);

    return Promise.reject(failure);
  });

  return {
    count: () => failures.length,
    last: () => failures.at(-1),
  };
}

function expectSerializationConflict(
  failure: unknown,
): asserts failure is SerializationConflictException {
  expect(failure).toBeInstanceOf(SerializationConflictException);
  const conflict = failure as SerializationConflictException;
  expect(conflict.getStatus()).toBe(HttpStatus.CONFLICT);
  expect(conflict.getResponse()).toMatchObject({
    code: 'SERIALIZATION_CONFLICT',
    statusCode: HttpStatus.CONFLICT,
  });
  expect(conflict.message).not.toMatch(/serialize|P2034|40001|deadlock/);
}

async function failureOf(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    return error as Error;
  }

  throw new Error('The operation did not fail');
}

function loggedEntries() {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

  return {
    failed: () =>
      warn.mock.calls
        .map(([entry]) => entry as OperationLogEntry)
        .filter((entry) => entry?.message === LEDGER_OPERATION_FINISHED),
  };
}
