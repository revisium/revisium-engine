import { setTimeout as delay } from 'node:timers/promises';
import {
  BenchBranch,
  cloneBranch,
  dropProjects,
  exactProject,
  loadBranch,
  runProjectId,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import {
  BenchProbe,
  emitResult,
} from 'src/features/partial-changes-poc/__bench__/support/bench-probe';
import {
  ITEMS,
  itemId,
  range,
} from 'src/features/partial-changes-poc/__bench__/support/data-dataset';
import { instrumentOperations } from 'src/features/partial-changes-poc/__bench__/support/instrumentation';
import {
  countTransactionAttempts,
  ensureRaceDataset,
  initialPrices,
  PriceWriters,
  readPrices,
  fenceNativeWrites,
  STOCK,
  TransactionAttempts,
  withExclusiveFence,
  WriteFence,
  WriterReport,
} from 'src/features/partial-changes-poc/__bench__/support/race-support';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import type {
  ApplyChangesResult,
  ChangesBranch,
  Selection,
} from 'src/features/partial-changes-poc/partial-changes.types';

type WriterOperation =
  | 'partial-commit'
  | 'native-commit'
  | 'partial-revert'
  | 'fenced-partial-commit';
type PairCase =
  | 'two-commits-different-tables'
  | 'two-commits-same-table-disjoint-rows'
  | 'two-commits-same-rows'
  | 'commit-and-revert-same-table';

const DEFAULT_ROWS = 5000;
const DEFAULT_REPEATS = 5;
const CONNECTIONS_PER_KIT = 10;
const WARMUP_MS = 300;
const TAIL_MS = 300;
const EVEN = 2;
const REPORTED_PROBLEMS = 10;
const NO_WRITER_CASES = [['partial-commit', 0]] as const;
const NO_PAIR_CASES = ['two-commits-same-rows'] as PairCase[];

const ROWS = Number(process.env.BENCH_RACE_ROWS ?? DEFAULT_ROWS);
const REPEATS = Number(process.env.BENCH_RACE_REPEATS ?? DEFAULT_REPEATS);
const WRITERS = (process.env.BENCH_WRITERS ?? '10,25,50')
  .split(',')
  .map(Number);
const selectedCases = (process.env.BENCH_CASES ?? 'all').split(',');
const enabled = (name: string) =>
  selectedCases.includes('all') || selectedCases.includes(name);

const writerCases = (
  [
    'partial-commit',
    'native-commit',
    'partial-revert',
    'fenced-partial-commit',
  ] as WriterOperation[]
)
  .filter(enabled)
  .flatMap((operation) =>
    WRITERS.map((writers) => [operation, writers] as const),
  );
const pairCases = (
  [
    'two-commits-different-tables',
    'two-commits-same-table-disjoint-rows',
    'two-commits-same-rows',
    'commit-and-revert-same-table',
  ] as PairCase[]
).filter(enabled);

describe(`races at ${ROWS} rows per table`, () => {
  let kit: PartialChangesTestKit;
  let probe: BenchProbe;
  let dataset: BenchBranch;
  const writerKits: PartialChangesTestKit[] = [];
  const writerAttempts: TransactionAttempts[] = [];
  const fence: WriteFence = { enabled: false };

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
    probe = new BenchProbe(kit.prisma);
    instrumentOperations(kit, probe);
    dataset = await ensureRaceDataset(kit, ROWS);

    const kitsNeeded = Math.ceil(Math.max(0, ...WRITERS) / CONNECTIONS_PER_KIT);
    for (let index = 0; index < kitsNeeded && writerCases.length > 0; index++) {
      const writerKit = await createPartialChangesTestKit();
      writerKits.push(writerKit);
      writerAttempts.push(countTransactionAttempts(writerKit));
      fenceNativeWrites(writerKit, fence);
    }
  });

  afterAll(async () => {
    for (const writerKit of writerKits) {
      await writerKit.close();
    }
    await kit.close();
  });

  (writerCases.length > 0
    ? it.each(writerCases)
    : it.skip.each(NO_WRITER_CASES))(
    '%s against %d native writers',
    async (operation, count) => {
      const run = await cloneBranch(
        kit.prisma,
        dataset,
        runProjectId('races', `${operation}-${count}`),
      );
      const revisionsBefore = await revisionCount(kit, run);
      const attemptsBefore = snapshot(writerAttempts);
      const kits = writerKits.slice(0, Math.ceil(count / CONNECTIONS_PER_KIT));
      const writers = new PriceWriters(kits, run, ROWS);

      fence.enabled = operation === 'fenced-partial-commit';
      writers.start(count);
      await delay(WARMUP_MS);
      const measurement = await probe.measure(() =>
        fence.enabled
          ? withExclusiveFence(kit, () =>
              writerRaceOperation(kit, run, 'partial-commit'),
            )
          : writerRaceOperation(kit, run, operation),
      );
      await delay(TAIL_MS);
      const report = await writers.stop();
      fence.enabled = false;
      const after = await loadBranch(kit.prisma, run.branchId);
      const result = measurement.value as ApplyChangesResult | undefined;
      const applied =
        !measurement.error &&
        (operation === 'native-commit' || result?.status === 'applied');
      const checked = fenceFree(operation);
      const consistency = await writerRaceConsistency(kit, after, {
        operation: checked,
        report,
        applied,
      });

      emitResult({
        kind: 'race',
        scenario: `${operation} vs native writers`,
        writers: count,
        writerKits: kits.length,
        rows: ROWS,
        status: applied ? 'applied' : (result?.status ?? 'error'),
        error: measurement.error,
        wallMs: measurement.wallMs,
        operationAttempts: measurement.attempts,
        writes: report.writes,
        writerFailures: report.failures,
        writerTransactionAttempts: difference(writerAttempts, attemptsBefore),
        revisionsAdded: (await revisionCount(kit, run)) - revisionsBefore,
        consistency,
      });
      await dropProjects(kit.prisma, exactProject(run.projectId));
      expect(consistency.problems).toEqual([]);
    },
  );

  (pairCases.length > 0 ? it.each(pairCases) : it.skip.each(NO_PAIR_CASES))(
    '%s',
    async (pairCase) => {
      const outcomes: Record<string, unknown>[] = [];
      for (let repeat = 0; repeat < REPEATS; repeat++) {
        const run = await cloneBranch(
          kit.prisma,
          dataset,
          runProjectId('races', `${pairCase}-${repeat}`),
        );
        const revisionsBefore = await revisionCount(kit, run);
        const measurement = await probe.measure(() =>
          Promise.all(pairOperations(kit, run, pairCase)),
        );
        const after = await loadBranch(kit.prisma, run.branchId);
        outcomes.push({
          statuses: (measurement.value ?? []).map(({ status }) => status),
          error: measurement.error,
          attempts: measurement.attempts,
          wallMs: measurement.wallMs,
          revisionsAdded: (await revisionCount(kit, run)) - revisionsBefore,
          consistency: await pairConsistency(kit, run, after, pairCase),
        });
        await dropProjects(kit.prisma, exactProject(run.projectId));
      }
      emitResult({ kind: 'race', scenario: pairCase, rows: ROWS, outcomes });
      expect(
        outcomes.flatMap(
          (outcome) => (outcome.consistency as { problems: string[] }).problems,
        ),
      ).toEqual([]);
    },
  );
});

function fenceFree(operation: WriterOperation): WriterOperation {
  return operation === 'fenced-partial-commit' ? 'partial-commit' : operation;
}

function branchOf(branch: BenchBranch): ChangesBranch {
  return { projectId: branch.projectId, branchName: branch.branchName };
}

function rowsOf(tableId: string, parity: 0 | 1): Selection {
  return {
    rows: range(0, ROWS)
      .filter((index) => index % EVEN === parity)
      .map((index) => ({ tableId, rowId: itemId(index) })),
  };
}

function writerRaceOperation(
  kit: PartialChangesTestKit,
  run: BenchBranch,
  operation: WriterOperation,
): Promise<unknown> {
  const branch = branchOf(run);
  switch (operation) {
    case 'partial-commit':
      return kit.changes.commitChanges({ branch, selection: rowsOf(ITEMS, 0) });
    case 'partial-revert':
      return kit.changes.revertChanges({ branch, selection: rowsOf(ITEMS, 0) });
    default:
      return kit.draftApi.apiCreateRevision(branch);
  }
}

function pairOperations(
  kit: PartialChangesTestKit,
  run: BenchBranch,
  pairCase: PairCase,
): Promise<ApplyChangesResult>[] {
  const branch = branchOf(run);
  const commit = (selection: Selection) =>
    kit.changes.commitChanges({ branch, selection });
  switch (pairCase) {
    case 'two-commits-different-tables':
      return [commit(rowsOf(ITEMS, 0)), commit(rowsOf(STOCK, 0))];
    case 'two-commits-same-table-disjoint-rows':
      return [commit(rowsOf(ITEMS, 0)), commit(rowsOf(ITEMS, 1))];
    case 'two-commits-same-rows':
      return [commit(rowsOf(ITEMS, 0)), commit(rowsOf(ITEMS, 0))];
    default:
      return [
        commit(rowsOf(ITEMS, 0)),
        kit.changes.revertChanges({ branch, selection: rowsOf(ITEMS, 1) }),
      ];
  }
}

async function writerRaceConsistency(
  kit: PartialChangesTestKit,
  after: BenchBranch,
  race: { operation: WriterOperation; report: WriterReport; applied: boolean },
) {
  const head = await readPrices(kit, after.headRevisionId, ITEMS);
  const draft = await readPrices(kit, after.draftRevisionId, ITEMS);
  const problems: string[] = [];

  for (const index of range(0, ROWS)) {
    const rowId = itemId(index);
    const headRow = head.get(rowId);
    const draftRow = draft.get(rowId);
    if (!headRow || !draftRow) {
      problems.push(`${rowId}: missing`);
      continue;
    }
    if (headRow.total !== headRow.price * headRow.qty || !headRow.readonly) {
      problems.push(`${rowId}: Head row inconsistent`);
    }
    const allowed = allowedPrices(index, race);
    if (!allowed.head.includes(headRow.price)) {
      problems.push(`${rowId}: Head price ${headRow.price} not allowed`);
    }
    if (!allowed.draft.includes(draftRow.price)) {
      problems.push(`${rowId}: Draft price ${draftRow.price} not allowed`);
    }
  }

  return {
    ok: problems.length === 0,
    problems: problems.slice(0, REPORTED_PROBLEMS),
    problemCount: problems.length,
  };
}

function allowedPrices(
  index: number,
  race: { operation: WriterOperation; report: WriterReport; applied: boolean },
): { head: number[]; draft: number[] } {
  const rowId = itemId(index);
  const initial = initialPrices(index);
  const acknowledged = [...(race.report.written.get(rowId) ?? [])];
  const last = race.report.lastWritten.get(rowId);
  const selected = index % EVEN === 0;
  const latestDraft = last ?? initial.draft;

  switch (race.operation) {
    case 'native-commit':
      return {
        head: race.applied ? [initial.draft, ...acknowledged] : [initial.head],
        draft: [latestDraft],
      };
    case 'partial-commit':
      return {
        head:
          race.applied && selected
            ? [initial.draft, ...acknowledged]
            : [initial.head],
        draft: [latestDraft],
      };
    default:
      return {
        head: [initial.head],
        draft:
          race.applied && selected
            ? [initial.head, ...(last === undefined ? [] : [last])]
            : [latestDraft],
      };
  }
}

async function pairConsistency(
  kit: PartialChangesTestKit,
  before: BenchBranch,
  after: BenchBranch,
  pairCase: PairCase,
) {
  const tables =
    pairCase === 'two-commits-different-tables' ? [ITEMS, STOCK] : [ITEMS];
  const problems: string[] = [];
  for (const tableId of tables) {
    problems.push(...(await pairTableProblems(kit, after, pairCase, tableId)));
  }

  const heads = await kit.prisma.revision.count({
    where: { branchId: before.branchId, isHead: true },
  });
  const drafts = await kit.prisma.revision.count({
    where: { branchId: before.branchId, isDraft: true },
  });
  if (heads !== 1 || drafts !== 1) {
    problems.push(`heads=${heads} drafts=${drafts}`);
  }
  return {
    ok: problems.length === 0,
    problems: problems.slice(0, REPORTED_PROBLEMS),
    problemCount: problems.length,
  };
}

async function pairTableProblems(
  kit: PartialChangesTestKit,
  after: BenchBranch,
  pairCase: PairCase,
  tableId: string,
): Promise<string[]> {
  const head = await readPrices(kit, after.headRevisionId, tableId);
  const draft = await readPrices(kit, after.draftRevisionId, tableId);
  const problems: string[] = [];

  for (const index of range(0, ROWS)) {
    const rowId = itemId(index);
    const expected = expectedPairPrices(pairCase, index);
    if (head.get(rowId)?.price !== expected.head) {
      problems.push(`${tableId}/${rowId}: Head ${head.get(rowId)?.price}`);
    }
    if (draft.get(rowId)?.price !== expected.draft) {
      problems.push(`${tableId}/${rowId}: Draft ${draft.get(rowId)?.price}`);
    }
  }
  return problems;
}

function expectedPairPrices(
  pairCase: PairCase,
  index: number,
): { head: number; draft: number } {
  const initial = initialPrices(index);
  const even = index % EVEN === 0;
  const committed = pairCase === 'two-commits-same-table-disjoint-rows' || even;
  const reverted = pairCase === 'commit-and-revert-same-table' && !even;
  return {
    head: committed ? initial.draft : initial.head,
    draft: reverted ? initial.head : initial.draft,
  };
}

function revisionCount(kit: PartialChangesTestKit, run: BenchBranch) {
  return kit.prisma.revision.count({ where: { branchId: run.branchId } });
}

function snapshot(stats: TransactionAttempts[]): TransactionAttempts {
  return sumAttempts(
    stats.map((item) => ({
      attempts: item.attempts,
      failures: { ...item.failures },
    })),
  );
}

function difference(
  stats: TransactionAttempts[],
  before: TransactionAttempts,
): TransactionAttempts {
  const now = sumAttempts(stats);
  const failures: Record<string, number> = {};
  for (const [code, count] of Object.entries(now.failures)) {
    const delta = count - (before.failures[code] ?? 0);
    if (delta > 0) {
      failures[code] = delta;
    }
  }
  return { attempts: now.attempts - before.attempts, failures };
}

function sumAttempts(stats: TransactionAttempts[]): TransactionAttempts {
  const total: TransactionAttempts = { attempts: 0, failures: {} };
  for (const item of stats) {
    total.attempts += item.attempts;
    for (const [code, count] of Object.entries(item.failures)) {
      total.failures[code] = (total.failures[code] ?? 0) + count;
    }
  }
  return total;
}
