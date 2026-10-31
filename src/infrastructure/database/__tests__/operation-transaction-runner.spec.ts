import { nanoid } from 'nanoid';
import { performance } from 'node:perf_hooks';
import {
  createDatabaseServiceTestKit,
  type DatabaseServiceTestKit,
} from 'src/__tests__/kit/create-database-service-test-kit';
import { isConnectionLost } from 'src/infrastructure/database/database-errors';
import { DeadlineHandle } from 'src/infrastructure/database/operation-deadline';
import { OperationTimeoutException } from 'src/infrastructure/database/operation-timeout.exception';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';
import { TransactionTimeoutSupport } from 'src/infrastructure/database/transaction-timeout-support';

const NATIVE_TRANSACTION_TIMEOUT_MS = 200;
const NATIVE_MAX_RETRIES = 10;
const OPERATION_TIMEOUT_MS = 1000;
const STATEMENT_BEYOND_TIMEOUT_MS = 10 * OPERATION_TIMEOUT_MS;
const LONG_AFTER_DEADLINE_MS = 2.5 * OPERATION_TIMEOUT_MS;
const SHORTER_SESSION_DEFAULT_MS = 300;
const LONGER_SESSION_DEFAULT_MS = 30 * OPERATION_TIMEOUT_MS;
const DEFAULT_MAX_ATTEMPTS = 3;
const CONFIGURED_MAX_ATTEMPTS = 2;

const RUNNER_SETTINGS = {
  TRANSACTION_TIMEOUT: String(NATIVE_TRANSACTION_TIMEOUT_MS),
  TRANSACTION_MAX_RETRIES: String(NATIVE_MAX_RETRIES),
  TRANSACTION_BASE_DELAY_MS: '1',
  TRANSACTION_MAX_DELAY_MS: '10',
  PARTIAL_CHANGES_OPERATION_TIMEOUT_MS: String(OPERATION_TIMEOUT_MS),
};

describe('OperationTransactionRunner', () => {
  describe('write attempts', () => {
    it('retry a serialization failure and commit the next attempt, planned from a fresh snapshot, once', async () => {
      const counter = await givenCounter(kit);
      const write = countAttempts(conflictingOnFirstAttempt(kit, counter));

      await runner.runWrite(write.run);

      expect(write.attempts).toBe(2);
      await expect(readCounter(kit, counter)).resolves.toBe(2);
    });

    it('stop after the default number of attempts, not the native retries, and surface the serialization failure', async () => {
      const counter = await givenCounter(kit);
      const write = countAttempts(() =>
        incrementAfterConcurrentIncrement(kit, counter),
      );

      await expect(runner.runWrite(write.run)).rejects.toMatchObject({
        code: 'P2034',
      });

      expect(write.attempts).toBe(DEFAULT_MAX_ATTEMPTS);
      await expect(readCounter(kit, counter)).resolves.toBe(
        DEFAULT_MAX_ATTEMPTS,
      );
    });
  });

  describe('operation timeout', () => {
    it('ends a write at the deadline while its statement still runs, with OperationTimeoutException, rolled back and not retried', async () => {
      const counter = await givenCounter(kit);
      const write = countAttempts(() =>
        incrementThenRunStatementFor(kit, counter, STATEMENT_BEYOND_TIMEOUT_MS),
      );

      const failure = await failureOf(runner.runWrite(write.run));

      expect(failure.error).toBeInstanceOf(OperationTimeoutException);
      expect(failure.elapsedMs).toBeLessThan(STATEMENT_BEYOND_TIMEOUT_MS);
      expect(write.attempts).toBe(1);
      await expect(readCounter(kit, counter)).resolves.toBe(0);
    });

    it('ends a write that stays idle in its transaction past it with OperationTimeoutException, rolled back and not retried', async () => {
      const counter = await givenCounter(kit);
      const write = countAttempts(() =>
        incrementThenIdleFor(kit, counter, 1.5 * OPERATION_TIMEOUT_MS),
      );

      await expect(runner.runWrite(write.run)).rejects.toThrow(
        OperationTimeoutException,
      );

      expect(write.attempts).toBe(1);
      await expect(readCounter(kit, counter)).resolves.toBe(0);
    });

    it('ends a write that continues after idling past it with OperationTimeoutException, rolled back', async () => {
      const counter = await givenCounter(kit);

      await expect(
        runner.runWrite(() =>
          incrementIdleThenContinue(kit, counter, 1.5 * OPERATION_TIMEOUT_MS),
        ),
      ).rejects.toThrow(OperationTimeoutException);

      await expect(readCounter(kit, counter)).resolves.toBe(0);
    });

    it('ends a write that continues long after its session ended with OperationTimeoutException, rolled back', async () => {
      const counter = await givenCounter(kit);

      await expect(
        runner.runWrite(() =>
          incrementIdleThenContinue(kit, counter, LONG_AFTER_DEADLINE_MS),
        ),
      ).rejects.toThrow(OperationTimeoutException);

      await expect(readCounter(kit, counter)).resolves.toBe(0);
    });

    it('ends planning at the deadline while its statement still runs, with OperationTimeoutException', async () => {
      const failure = await failureOf(
        runner.runPlanning(() =>
          runStatementFor(kit, STATEMENT_BEYOND_TIMEOUT_MS),
        ),
      );

      expect(failure.error).toBeInstanceOf(OperationTimeoutException);
      expect(failure.elapsedMs).toBeLessThan(STATEMENT_BEYOND_TIMEOUT_MS);
    });

    it('covers a statement the operation returns without awaiting it', async () => {
      const failure = await failureOf(
        runner.runWrite(() => statementFor(kit, STATEMENT_BEYOND_TIMEOUT_MS)),
      );

      expect(failure.error).toBeInstanceOf(OperationTimeoutException);
      expect(failure.elapsedMs).toBeLessThan(STATEMENT_BEYOND_TIMEOUT_MS);
    });

    it('keeps a P2028 of an already closed transaction before the deadline as it is', async () => {
      const closed = await transactionOfCommittedOperation(kit, runner);

      const failure = await failureOf(
        runner.runWrite(() => closed.transaction.projectFileUsage.count()),
      );

      expect(failure.error).toMatchObject({ code: 'P2028' });
    });

    it('keeps a failure that is not a timeout although its rollback ends after the deadline', async () => {
      const counter = await givenCounter(kit);

      const failure = await failureOf(
        runner.runWrite(() =>
          failWithDuplicateWhileStatementRuns(
            kit,
            counter,
            STATEMENT_BEYOND_TIMEOUT_MS,
          ),
        ),
      );

      expect(failure.elapsedMs).toBeGreaterThanOrEqual(OPERATION_TIMEOUT_MS);
      expect(failure.error).toMatchObject({ code: 'P2002' });
    });
  });

  describe('planning', () => {
    it('completes when it outlives the native transaction timeout within the operation timeout', async () => {
      await expect(
        runner.runPlanning(() =>
          runStatementFor(kit, 2 * NATIVE_TRANSACTION_TIMEOUT_MS),
        ),
      ).resolves.toBeUndefined();
    });

    it('refuses a write', async () => {
      const counter = await givenCounter(kit);

      await expect(
        runner.runPlanning(() => increment(kit, counter)),
      ).rejects.toThrow('read-only transaction');

      await expect(readCounter(kit, counter)).resolves.toBe(0);
    });

    it('reads one snapshot while a concurrent write commits', async () => {
      const counter = await givenCounter(kit);

      const reads = await runner.runPlanning(() =>
        readAroundConcurrentIncrement(kit, counter),
      );

      expect(reads).toEqual({ before: 0, after: 0 });
    });
  });

  describe('connection reuse', () => {
    it('leaves no timeout on the connection of a committed operation', async () => {
      const backendPid = await runner.runWrite(() => readBackendPid(kit));

      await expect(runTransactionLongerThanOperationTimeout(kit)).resolves.toBe(
        backendPid,
      );
    });

    it('leaves no timeout on the connection of a rolled-back operation', async () => {
      const operation = failingAfterReadingBackendPid(kit);

      await expect(runner.runWrite(operation.run)).rejects.toThrow(
        OPERATION_FAILURE,
      );

      await expect(runTransactionLongerThanOperationTimeout(kit)).resolves.toBe(
        operation.backendPid,
      );
    });
  });

  describe('on connections whose transaction_timeout default is shorter than the operation timeout', () => {
    it('do not end an operation before its own deadline', async () => {
      await expect(
        shortDefaultRunner.runPlanning(() =>
          runStatementFor(shortDefaultKit, 2 * SHORTER_SESSION_DEFAULT_MS),
        ),
      ).resolves.toBeUndefined();
    });

    let shortDefaultKit: DatabaseServiceTestKit;
    let shortDefaultRunner: OperationTransactionRunner;

    beforeAll(async () => {
      shortDefaultKit = await createKitWithTransactionTimeoutDefault(
        SHORTER_SESSION_DEFAULT_MS,
      );
      shortDefaultRunner = shortDefaultKit.module.get(
        OperationTransactionRunner,
      );
    });

    afterAll(async () => {
      await shortDefaultKit.close();
    });
  });

  describe('on connections whose transaction_timeout default is longer than the operation timeout', () => {
    it('still end an operation at its own deadline', async () => {
      const failure = await failureOf(
        longDefaultRunner.runPlanning(() =>
          runStatementFor(longDefaultKit, STATEMENT_BEYOND_TIMEOUT_MS),
        ),
      );

      expect(failure.error).toBeInstanceOf(OperationTimeoutException);
      expect(failure.elapsedMs).toBeLessThan(STATEMENT_BEYOND_TIMEOUT_MS);
    });

    let longDefaultKit: DatabaseServiceTestKit;
    let longDefaultRunner: OperationTransactionRunner;

    beforeAll(async () => {
      longDefaultKit = await createKitWithTransactionTimeoutDefault(
        LONGER_SESSION_DEFAULT_MS,
      );
      longDefaultRunner = longDefaultKit.module.get(OperationTransactionRunner);
    });

    afterAll(async () => {
      await longDefaultKit.close();
    });
  });

  describe('on servers without transaction_timeout', () => {
    it('cuts a statement still running at the deadline with OperationTimeoutException, rolled back', async () => {
      const counter = await givenCounter(fallbackKit);

      const failure = await failureOf(
        fallbackRunner.runWrite(() =>
          incrementThenRunStatementFor(
            fallbackKit,
            counter,
            STATEMENT_BEYOND_TIMEOUT_MS,
          ),
        ),
      );

      expect(failure.error).toBeInstanceOf(OperationTimeoutException);
      expect(failure.elapsedMs).toBeLessThan(STATEMENT_BEYOND_TIMEOUT_MS);
      await expect(readCounter(fallbackKit, counter)).resolves.toBe(0);
    });

    it('cuts a statement started after a checkpoint at the deadline', async () => {
      const failure = await failureOf(
        fallbackRunner.runWrite((deadline) =>
          runStatementsAroundCheckpoint(fallbackKit, deadline, {
            beforeMs: 0.6 * OPERATION_TIMEOUT_MS,
            afterMs: STATEMENT_BEYOND_TIMEOUT_MS,
          }),
        ),
      );

      expect(failure.error).toBeInstanceOf(OperationTimeoutException);
      expect(failure.elapsedMs).toBeLessThan(1.3 * OPERATION_TIMEOUT_MS);
    });

    it('ends the session of an operation that idles past the remaining budget, reported as OperationTimeoutException', async () => {
      const counter = await givenCounter(fallbackKit);

      const failure = await failureOf(
        fallbackRunner.runWrite(() =>
          incrementIdleThenContinue(
            fallbackKit,
            counter,
            1.5 * OPERATION_TIMEOUT_MS,
          ),
        ),
      );

      expect(failure.error).toBeInstanceOf(OperationTimeoutException);
      expectEndedSession((failure.error as OperationTimeoutException).cause);
      await expect(readCounter(fallbackKit, counter)).resolves.toBe(0);
    });

    it('refuses a checkpoint after the deadline with OperationTimeoutException', async () => {
      const checkpoint = await checkpointAfterIdling(
        fallbackRunner,
        1.5 * OPERATION_TIMEOUT_MS,
      );

      expect(checkpoint).toBeInstanceOf(OperationTimeoutException);
    });

    it('rolls back an operation that finishes after its deadline', async () => {
      const counter = await givenCounter(fallbackKit);

      await expect(
        fallbackRunner.runWrite(() =>
          incrementThenIdleFor(
            fallbackKit,
            counter,
            1.5 * OPERATION_TIMEOUT_MS,
          ),
        ),
      ).rejects.toThrow(OperationTimeoutException);

      await expect(readCounter(fallbackKit, counter)).resolves.toBe(0);
    });

    it('ends an operation that continues long after its session ended with OperationTimeoutException, rolled back', async () => {
      const counter = await givenCounter(fallbackKit);

      await expect(
        fallbackRunner.runWrite(() =>
          incrementIdleThenContinue(
            fallbackKit,
            counter,
            LONG_AFTER_DEADLINE_MS,
          ),
        ),
      ).rejects.toThrow(OperationTimeoutException);

      await expect(readCounter(fallbackKit, counter)).resolves.toBe(0);
    });

    it('covers a statement the operation returns without awaiting it', async () => {
      const failure = await failureOf(
        fallbackRunner.runWrite(() =>
          statementFor(fallbackKit, STATEMENT_BEYOND_TIMEOUT_MS),
        ),
      );

      expect(failure.error).toBeInstanceOf(OperationTimeoutException);
      expect(failure.elapsedMs).toBeLessThan(STATEMENT_BEYOND_TIMEOUT_MS);
    });

    it('keeps a statement cancellation before the deadline as it is', async () => {
      const failure = await failureOf(
        fallbackRunner.runWrite(() =>
          runStatementPastOwnStatementTimeout(fallbackKit),
        ),
      );

      expect(failure.error).not.toBeInstanceOf(OperationTimeoutException);
      expect(failure.error).toMatchObject({
        message: expect.stringContaining(
          'canceling statement due to statement timeout',
        ),
      });
    });

    it('leaves no setting on the connection of a committed operation', async () => {
      const backendPid = await fallbackRunner.runWrite(() =>
        readBackendPid(fallbackKit),
      );

      await expect(
        runTransactionLongerThanOperationTimeout(fallbackKit),
      ).resolves.toBe(backendPid);
    });

    it('leaves no setting on the connection of a rolled-back operation', async () => {
      const operation = failingAfterReadingBackendPid(fallbackKit);

      await expect(fallbackRunner.runWrite(operation.run)).rejects.toThrow(
        OPERATION_FAILURE,
      );

      await expect(
        runTransactionLongerThanOperationTimeout(fallbackKit),
      ).resolves.toBe(operation.backendPid);
    });

    let fallbackKit: DatabaseServiceTestKit;
    let fallbackRunner: OperationTransactionRunner;

    beforeAll(async () => {
      fallbackKit = await createDatabaseServiceTestKit([], RUNNER_SETTINGS, [
        {
          provide: TransactionTimeoutSupport,
          useValue: serverWithoutTransactionTimeout,
        },
      ]);
      fallbackRunner = fallbackKit.module.get(OperationTransactionRunner);
    });

    afterAll(async () => {
      await fallbackKit.close();
    });
  });

  describe('with PARTIAL_CHANGES_MAX_ATTEMPTS configured', () => {
    it('stops after the configured number of attempts', async () => {
      const counter = await givenCounter(configuredKit);
      const write = countAttempts(() =>
        incrementAfterConcurrentIncrement(configuredKit, counter),
      );

      await expect(configuredRunner.runWrite(write.run)).rejects.toMatchObject({
        code: 'P2034',
      });

      expect(write.attempts).toBe(CONFIGURED_MAX_ATTEMPTS);
    });

    let configuredKit: DatabaseServiceTestKit;
    let configuredRunner: OperationTransactionRunner;

    beforeAll(async () => {
      configuredKit = await createDatabaseServiceTestKit([], {
        PARTIAL_CHANGES_MAX_ATTEMPTS: String(CONFIGURED_MAX_ATTEMPTS),
      });
      configuredRunner = configuredKit.module.get(OperationTransactionRunner);
    });

    afterAll(async () => {
      await configuredKit.close();
    });
  });

  let kit: DatabaseServiceTestKit;
  let runner: OperationTransactionRunner;

  beforeAll(async () => {
    kit = await createDatabaseServiceTestKit([], RUNNER_SETTINGS);
    runner = kit.module.get(OperationTransactionRunner);
  });

  afterAll(async () => {
    await kit.close();
  });
});

const OPERATION_FAILURE = 'operation failed';

const serverWithoutTransactionTimeout: TransactionTimeoutSupport = {
  isSupportedOn: () => Promise.resolve(false),
};

function expectEndedSession(cause: unknown) {
  expect(isConnectionLost(cause)).toBe(true);
}

async function failureOf(operation: Promise<unknown>) {
  const startedAt = performance.now();
  const error = await operation.then(
    () => undefined,
    (reason: unknown) => reason,
  );

  return { error, elapsedMs: performance.now() - startedAt };
}

async function createKitWithTransactionTimeoutDefault(
  defaultMs: number,
): Promise<DatabaseServiceTestKit> {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const urlWithDefault = new URL(databaseUrl);
  urlWithDefault.searchParams.set(
    'options',
    `-c transaction_timeout=${defaultMs}`,
  );

  process.env.DATABASE_URL = urlWithDefault.toString();

  try {
    return await createDatabaseServiceTestKit([], RUNNER_SETTINGS);
  } finally {
    process.env.DATABASE_URL = databaseUrl;
  }
}

interface Counter {
  projectId: string;
}

async function givenCounter(kit: DatabaseServiceTestKit): Promise<Counter> {
  const counter = { projectId: `operation-transaction-${nanoid()}` };

  await kit.prismaService.projectFileUsage.create({ data: counter });

  return counter;
}

async function readCounter(
  kit: DatabaseServiceTestKit,
  counter: Counter,
): Promise<number> {
  const usage = await kit.prismaService.projectFileUsage.findUniqueOrThrow({
    where: counter,
  });

  return Number(usage.fileBytes);
}

function countAttempts(attempt: () => Promise<void>) {
  const counted = {
    attempts: 0,
    async run() {
      counted.attempts += 1;
      await attempt();
    },
  };

  return counted;
}

function conflictingOnFirstAttempt(
  kit: DatabaseServiceTestKit,
  counter: Counter,
): () => Promise<void> {
  let attempted = false;

  return () => {
    if (attempted) {
      return increment(kit, counter);
    }

    attempted = true;
    return incrementAfterConcurrentIncrement(kit, counter);
  };
}

async function checkpointAfterIdling(
  runner: OperationTransactionRunner,
  idleMs: number,
): Promise<unknown> {
  let checkpoint: unknown;

  await runner
    .runWrite(async (deadline) => {
      await idleFor(idleMs);
      checkpoint = await deadline.checkpoint().then(
        () => 'passed',
        (error: unknown) => error,
      );
    })
    .catch(() => undefined);

  return checkpoint;
}

async function transactionOfCommittedOperation(
  kit: DatabaseServiceTestKit,
  runner: OperationTransactionRunner,
) {
  return runner.runWrite(() =>
    Promise.resolve({ transaction: kit.transactionService.getTransaction() }),
  );
}

function failingAfterReadingBackendPid(kit: DatabaseServiceTestKit) {
  const operation = {
    backendPid: 0,
    async run() {
      operation.backendPid = await readBackendPid(kit);
      throw new Error(OPERATION_FAILURE);
    },
  };

  return operation;
}

async function increment(
  kit: DatabaseServiceTestKit,
  counter: Counter,
): Promise<void> {
  const value = await readCounterInTransaction(kit, counter);
  await writeCounterInTransaction(kit, counter, value + 1);
}

async function incrementAfterConcurrentIncrement(
  kit: DatabaseServiceTestKit,
  counter: Counter,
): Promise<void> {
  const value = await readCounterInTransaction(kit, counter);
  await incrementConcurrently(kit, counter);
  await writeCounterInTransaction(kit, counter, value + 1);
}

async function incrementThenRunStatementFor(
  kit: DatabaseServiceTestKit,
  counter: Counter,
  durationMs: number,
): Promise<void> {
  await increment(kit, counter);
  await runStatementFor(kit, durationMs);
}

async function incrementThenIdleFor(
  kit: DatabaseServiceTestKit,
  counter: Counter,
  durationMs: number,
): Promise<void> {
  await increment(kit, counter);
  await idleFor(durationMs);
}

function idleFor(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function runStatementsAroundCheckpoint(
  kit: DatabaseServiceTestKit,
  deadline: DeadlineHandle,
  durations: { beforeMs: number; afterMs: number },
): Promise<void> {
  await runStatementFor(kit, durations.beforeMs);
  await deadline.checkpoint();
  await runStatementFor(kit, durations.afterMs);
}

async function runStatementPastOwnStatementTimeout(
  kit: DatabaseServiceTestKit,
): Promise<void> {
  await kit.transactionService.getTransaction()
    .$executeRaw`SELECT set_config('statement_timeout', '100', true)`;
  await runStatementFor(kit, 300);
}

async function incrementIdleThenContinue(
  kit: DatabaseServiceTestKit,
  counter: Counter,
  idleMs: number,
): Promise<void> {
  await incrementThenIdleFor(kit, counter, idleMs);
  await readCounterInTransaction(kit, counter);
}

async function failWithDuplicateWhileStatementRuns(
  kit: DatabaseServiceTestKit,
  counter: Counter,
  durationMs: number,
): Promise<void> {
  statementFor(kit, durationMs).catch(() => undefined);
  await kit.prismaService.projectFileUsage.create({ data: counter });
}

async function readAroundConcurrentIncrement(
  kit: DatabaseServiceTestKit,
  counter: Counter,
) {
  const before = await readCounterInTransaction(kit, counter);
  await incrementConcurrently(kit, counter);
  const after = await readCounterInTransaction(kit, counter);

  return { before, after };
}

function runTransactionLongerThanOperationTimeout(
  kit: DatabaseServiceTestKit,
): Promise<number> {
  return kit.transactionService.run(
    async () => {
      await runStatementFor(kit, 1.5 * OPERATION_TIMEOUT_MS);
      return readBackendPid(kit);
    },
    { timeout: 5 * OPERATION_TIMEOUT_MS },
  );
}

async function readCounterInTransaction(
  kit: DatabaseServiceTestKit,
  counter: Counter,
): Promise<number> {
  const usage = await kit.transactionService
    .getTransaction()
    .projectFileUsage.findUniqueOrThrow({ where: counter });

  return Number(usage.fileBytes);
}

async function writeCounterInTransaction(
  kit: DatabaseServiceTestKit,
  counter: Counter,
  value: number,
): Promise<void> {
  await kit.transactionService
    .getTransaction()
    .projectFileUsage.update({ where: counter, data: { fileBytes: value } });
}

async function incrementConcurrently(
  kit: DatabaseServiceTestKit,
  counter: Counter,
): Promise<void> {
  await kit.prismaService.projectFileUsage.update({
    where: counter,
    data: { fileBytes: { increment: 1 } },
  });
}

async function readBackendPid(kit: DatabaseServiceTestKit): Promise<number> {
  const [session] = await kit.transactionService.getTransaction().$queryRaw<
    { pid: number }[]
  >`SELECT pg_backend_pid() AS pid`;

  return session?.pid ?? 0;
}

async function runStatementFor(
  kit: DatabaseServiceTestKit,
  durationMs: number,
): Promise<void> {
  await statementFor(kit, durationMs);
}

function statementFor(
  kit: DatabaseServiceTestKit,
  durationMs: number,
): Promise<number> {
  return kit.transactionService.getTransaction()
    .$executeRaw`SELECT pg_sleep(${durationMs / 1000})`;
}
