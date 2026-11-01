import { randomInt } from 'node:crypto';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { sql } from 'src/engine-prisma-types';
import { holdAdvisoryLock } from './branch-write-fence';

const MAX_GATE_KEY = 2_147_483_647;

// A transaction gate is an advisory lock the test holds: a transaction that
// waits at it stays open, inside a statement or inside its COMMIT, until the
// test opens the gate.
export interface TransactionGate {
  key: number;
  open(): Promise<void>;
}

export async function closeTransactionGate(
  kit: DraftTestKit,
): Promise<TransactionGate> {
  const key = randomInt(1, MAX_GATE_KEY);
  const holder = await holdAdvisoryLock(
    kit,
    sql`pg_advisory_xact_lock(${key})`,
  );

  return { key, open: holder.release };
}

export async function waitAtGate(
  kit: DraftTestKit,
  gate: TransactionGate,
): Promise<void> {
  await kit.transactionService.getTransaction()
    .$executeRaw`SELECT pg_advisory_xact_lock(${gate.key})`;
}

// A deferred constraint trigger fires inside COMMIT, so the transaction's
// COMMIT waits at the gate after every statement of the operation ran.
export async function waitAtGateOnCommit(
  kit: DraftTestKit,
  gate: TransactionGate,
): Promise<void> {
  const transaction = kit.transactionService.getTransaction();

  await transaction.$executeRaw`SELECT set_config('revisium_test.commit_gate', ${String(gate.key)}, true)`;
  await transaction.$executeRaw`CREATE TEMP TABLE commit_gate (id integer) ON COMMIT DROP`;
  await transaction.$executeRaw`
    CREATE OR REPLACE FUNCTION pg_temp.wait_at_commit_gate() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(current_setting('revisium_test.commit_gate')::bigint);
      RETURN NULL;
    END
    $$`;
  await transaction.$executeRaw`
    CREATE CONSTRAINT TRIGGER wait_at_commit_gate AFTER INSERT ON commit_gate
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION pg_temp.wait_at_commit_gate()`;
  await transaction.$executeRaw`INSERT INTO commit_gate VALUES (1)`;
}

export async function waitUntilWaitingAtGate(
  kit: DraftTestKit,
  gate: TransactionGate,
  backendPid: number,
): Promise<void> {
  let isWaiting = false;

  while (!isWaiting) {
    const waiters = await kit.prismaService.$queryRaw<unknown[]>`
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory'
        AND pid = ${backendPid}
        AND NOT granted
        AND ((classid::bigint << 32) | objid::bigint) = ${gate.key}`;
    isWaiting = waiters.length > 0;
  }
}

export async function waitUntilTransactionIsOlderThan(
  kit: DraftTestKit,
  backendPid: number,
  ageMs: number,
): Promise<void> {
  let isYounger = true;

  while (isYounger) {
    const [session] = await kit.prismaService.$queryRaw<
      { hasEnded: boolean; isYounger: boolean }[]
    >`
      SELECT xact_start IS NULL AS "hasEnded",
             clock_timestamp() - xact_start
               < make_interval(secs => ${ageMs}::double precision / 1000) AS "isYounger"
      FROM pg_stat_activity
      WHERE pid = ${backendPid}`;

    if (!session || session.hasEnded) {
      throw new Error('The transaction ended before it was old enough');
    }

    isYounger = session.isYounger;
  }
}
