import { HttpStatus, Logger } from '@nestjs/common';
import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { givenActiveMigration } from 'src/__tests__/fixtures/active-migration';
import { BranchApiService } from 'src/features/branch/branch-api.service';
import { serializationFailure } from 'src/features/draft-revision/services/__tests__/support/revision-lookup-test-kit';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { OPERATION_FINISHED } from 'src/features/partial-changes/logging/partial-operation-fields';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { FindTableInRevisionHandler } from 'src/features/share/queries/handlers/transactional/find-table-in-revision.handler';
import { isSerializationFailure } from 'src/infrastructure/database/database-errors';
import type { OperationLogEntry } from 'src/infrastructure/database/operation-log';
import { SerializationConflictException } from 'src/infrastructure/database/serialization-conflict.exception';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { commitWhileNativeWriteLands } from '../../__tests__/support/commit-races';
import { revertWhileNativeWriteLands } from '../../__tests__/support/revert-races';

const PRODUCTS = 'products';

// A valid table id that contains the text the serialization predicate matches.
const SERIALIZATION_TEXT_TABLE_ID = 'TransactionWriteConflict';

const pricedSchema = obj({ title: str(), price: num() });

const titleOfP1: Selection = {
  fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/title' }],
};

const ONE_ATTEMPT_SETTINGS = {
  PARTIAL_CHANGES_MAX_ATTEMPTS: '1',
  TRANSACTION_MAX_RETRIES: '2',
  TRANSACTION_BASE_DELAY_MS: '1',
  TRANSACTION_MAX_DELAY_MS: '10',
};

interface RacedOperation {
  readonly operation: 'commit' | 'revert';
  run(draft: ChangesScenario): Promise<unknown>;
  race(
    kit: PartialChangesTestKit,
    draft: ChangesScenario,
    nativeWrite: () => Promise<unknown>,
  ): Promise<unknown>;
}

const racedOperations: RacedOperation[] = [
  {
    operation: 'commit',
    run: (draft) => draft.commitChanges({ selection: titleOfP1 }),
    race: (kit, draft, nativeWrite) =>
      commitWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        nativeWrite,
      ),
  },
  {
    operation: 'revert',
    run: (draft) => draft.revertChanges({ selection: titleOfP1 }),
    race: (kit, draft, nativeWrite) =>
      revertWhileNativeWriteLands(
        kit,
        draft,
        { selection: titleOfP1 },
        nativeWrite,
      ),
  },
];

describe('Partial operations whose attempts are spent', () => {
  describe.each(racedOperations)(
    'a partial $operation',
    ({ operation, race }) => {
      it('that loses its last attempt to a native write fails with SERIALIZATION_CONFLICT (409), keeping the database error as its cause, and writes nothing', async () => {
        const draft = await givenEditedPrices();

        const failure = await failureOf(
          race(kit, draft, () =>
            draft.updateRow(PRODUCTS, 'p1', { title: 'uno!', price: 11 }),
          ),
        );

        expect(failure).toBeInstanceOf(SerializationConflictException);
        const conflict = failure as SerializationConflictException;
        expect(conflict.getStatus()).toBe(HttpStatus.CONFLICT);
        expect(conflict.getResponse()).toMatchObject({
          code: 'SERIALIZATION_CONFLICT',
          statusCode: HttpStatus.CONFLICT,
        });
        expect(conflict.message).not.toMatch(/serialize|P2034|40001|deadlock/);
        expect(isSerializationFailure(conflict.cause)).toBe(true);
        expect((await draft.row('head', PRODUCTS, 'p1')).data).toEqual({
          title: 'one',
          price: 1,
        });
        expect((await draft.row('draft', PRODUCTS, 'p1')).data).toEqual({
          title: 'uno!',
          price: 11,
        });
      });

      it('logs the failure with the code SERIALIZATION_CONFLICT and the attempt it made', async () => {
        const draft = await givenEditedPrices();
        const entries = loggedEntries();

        await failureOf(
          race(kit, draft, () =>
            draft.updateRow(PRODUCTS, 'p1', { title: 'uno!', price: 11 }),
          ),
        );

        expect(entries.failed()).toMatchObject([
          {
            operation,
            outcome: 'error',
            attempts: 1,
            escalations: 0,
            error: 'SerializationConflictException',
            errorCode: 'SERIALIZATION_CONFLICT',
          },
        ]);
      });
    },
  );

  describe.each(racedOperations)(
    'a partial $operation refused by an engine exception whose message carries serialization text',
    ({ operation, run }) => {
      it('fails with that exception and its details, logged with its own code', async () => {
        const draft = await givenEditedPrices();
        await givenActiveMigration(kit, draft, SERIALIZATION_TEXT_TABLE_ID);
        const entries = loggedEntries();

        const failure = await failureOf(run(draft));

        expect(failure).toBeInstanceOf(MigrationLockedException);
        expect(
          (failure as MigrationLockedException).getResponse(),
        ).toMatchObject({
          code: 'MIGRATION_LOCKED',
          migration: { tableId: SERIALIZATION_TEXT_TABLE_ID },
        });
        expect(entries.failed()).toMatchObject([
          {
            operation,
            outcome: 'error',
            error: 'MigrationLockedException',
            errorCode: 'MIGRATION_LOCKED',
          },
        ]);
      });
    },
  );

  describe('a native write next to them', () => {
    it('keeps the serialization failure of its last attempt as it is', async () => {
      const draft = await givenEditedPrices();
      const failure = serializationFailure();
      jest
        .spyOn(kit.module.get(FindTableInRevisionHandler), 'execute')
        .mockRejectedValue(failure);

      await expect(
        draft.updateRow(PRODUCTS, 'p1', { title: 'uno!', price: 11 }),
      ).rejects.toBe(failure);
    });

    it('keeps the serialization failure of the last attempt of a native commit as it is', async () => {
      const draft = await givenEditedPrices();
      const failure = serializationFailure();
      jest
        .spyOn(kit.module.get(BranchApiService), 'getHeadRevision')
        .mockRejectedValue(failure);

      await expect(draft.commit()).rejects.toBe(failure);
    });
  });

  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({ settings: ONE_ATTEMPT_SETTINGS });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function givenEditedPrices(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: pricedSchema,
        rows: { p1: { title: 'one', price: 1 } },
      },
    });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 10 });

    return draft;
  }
});

async function failureOf(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }

  throw new Error('The operation did not fail');
}

function loggedEntries() {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

  return {
    failed: () =>
      warn.mock.calls
        .map(([entry]) => entry as OperationLogEntry)
        .filter((entry) => entry?.message === OPERATION_FINISHED),
  };
}
