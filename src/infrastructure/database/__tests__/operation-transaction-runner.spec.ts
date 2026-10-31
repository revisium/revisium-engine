import { nanoid } from 'nanoid';
import { performance } from 'node:perf_hooks';
import {
  createDatabaseServiceTestKit,
  type DatabaseServiceTestKit,
} from 'src/__tests__/kit/create-database-service-test-kit';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import { OperationDeadline } from 'src/infrastructure/database/operation-deadline';
import { OperationTimeoutException } from 'src/infrastructure/database/operation-timeout.exception';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';
import { StatementBudgets } from 'src/infrastructure/database/statement-budgets';

const NATIVE_TRANSACTION_TIMEOUT_MS = 200;
const NATIVE_MAX_RETRIES = 10;
const OPERATION_TIMEOUT_MS = 1000;
const STATEMENT_BEYOND_TIMEOUT_MS = 10 * OPERATION_TIMEOUT_MS;
const DEFAULT_MAX_ATTEMPTS = 3;
const CONFIGURED_MAX_ATTEMPTS = 2;

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

    it('ends planning at the deadline while its statement still runs, with OperationTimeoutException', async () => {
      const failure = await failureOf(
        runner.runPlanning(() =>
          runStatementFor(kit, STATEMENT_BEYOND_TIMEOUT_MS),
        ),
      );

      expect(failure.error).toBeInstanceOf(OperationTimeoutException);
      expect(failure.elapsedMs).toBeLessThan(STATEMENT_BEYOND_TIMEOUT_MS);
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

  describe('statement budgets on servers without transaction_timeout', () => {
    it('limit each statement to the time left until the deadline', async () => {
      const elapsedMs = 300;

      const limits = await runWithStatementBudgets(kit, () =>
        statementTimeoutsAroundStatementFor(kit, elapsedMs),
      );

      expectBudgetOfAtMost(limits.first, OPERATION_TIMEOUT_MS);
      expectBudgetOfAtMost(limits.afterwards, OPERATION_TIMEOUT_MS - elapsedMs);
    });

    it('cancel a statement that is still running at the deadline', async () => {
      const failure = await failureOf(
        runWithStatementBudgets(kit, () =>
          runStatementFor(kit, STATEMENT_BEYOND_TIMEOUT_MS),
        ),
      );

      expect(failure.error).toMatchObject({
        message: expect.stringContaining(
          'canceling statement due to statement timeout',
        ),
      });
      expect(failure.elapsedMs).toBeLessThan(STATEMENT_BEYOND_TIMEOUT_MS);
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
    kit = await createDatabaseServiceTestKit([], {
      TRANSACTION_TIMEOUT: String(NATIVE_TRANSACTION_TIMEOUT_MS),
      TRANSACTION_MAX_RETRIES: String(NATIVE_MAX_RETRIES),
      TRANSACTION_BASE_DELAY_MS: '1',
      TRANSACTION_MAX_DELAY_MS: '10',
      PARTIAL_CHANGES_OPERATION_TIMEOUT_MS: String(OPERATION_TIMEOUT_MS),
    });
    runner = kit.module.get(OperationTransactionRunner);
  });

  afterAll(async () => {
    await kit.close();
  });
});

function expectBudgetOfAtMost(budgetMs: number, maxMs: number) {
  expect(budgetMs).toBeGreaterThan(0);
  expect(budgetMs).toBeLessThanOrEqual(maxMs);
}

async function failureOf(operation: Promise<unknown>) {
  const startedAt = performance.now();
  const error = await operation.then(
    () => undefined,
    (reason: unknown) => reason,
  );

  return { error, elapsedMs: performance.now() - startedAt };
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
  await new Promise((resolve) => setTimeout(resolve, durationMs));
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

async function statementTimeoutsAroundStatementFor(
  kit: DatabaseServiceTestKit,
  durationMs: number,
) {
  const first = await readStatementTimeout(kit);
  await runStatementFor(kit, durationMs);
  const afterwards = await readStatementTimeout(kit);

  return { first, afterwards };
}

function runWithStatementBudgets<T>(
  kit: DatabaseServiceTestKit,
  body: () => Promise<T>,
): Promise<T> {
  const budgets = new StatementBudgets(
    kit.prismaService,
    kit.transactionService,
  );

  return budgets.runTransaction(
    new OperationDeadline(OPERATION_TIMEOUT_MS),
    {
      isolationLevel: TransactionIsolationLevel.Serializable,
      timeout: 5 * OPERATION_TIMEOUT_MS,
    },
    body,
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

async function runStatementFor(
  kit: DatabaseServiceTestKit,
  durationMs: number,
): Promise<void> {
  await kit.transactionService.getTransaction()
    .$executeRaw`SELECT pg_sleep(${durationMs / 1000})`;
}

async function readStatementTimeout(
  kit: DatabaseServiceTestKit,
): Promise<number> {
  const [setting] = await kit.transactionService.getTransaction().$queryRaw<
    { ms: number }[]
  >`SELECT setting::int AS ms FROM pg_settings WHERE name = 'statement_timeout'`;

  return setting?.ms ?? 0;
}
