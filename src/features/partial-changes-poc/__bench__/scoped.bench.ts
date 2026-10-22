import {
  BenchBranch,
  cloneBranch,
  dropProjects,
  exactProject,
  findBenchBranch,
  loadBranch,
  moveToProject,
  runProjectId,
  tableVersionId,
  analyze,
  BENCH_PROJECT_PREFIX,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import {
  BenchProbe,
  emitResult,
} from 'src/features/partial-changes-poc/__bench__/support/bench-probe';
import {
  changeItems,
  createItems,
  headItem,
  ITEMS,
  itemId,
  startBuilding,
  timed,
} from 'src/features/partial-changes-poc/__bench__/support/data-dataset';
import { instrumentOperations } from 'src/features/partial-changes-poc/__bench__/support/instrumentation';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import type {
  ApplyChangesResult,
  ChangesBranch,
} from 'src/features/partial-changes-poc/partial-changes.types';
import { DEFAULT_LIMITS } from 'src/features/partial-changes-poc/planning/operation-limits.service';

type ScopedCase =
  | 'ensure'
  | 'commit-field'
  | 'revert-field'
  | 'full-read-commit-field';

type DatasetKind = 'busy' | 'quiet';

const NOTES = 'notes';
const NOTES_ROWS = 1000;
const EDITED_PRICE = 9999;
const DEFAULT_UNRELATED_ROWS = 200_000;
const DEFAULT_RUNS = 3;
const UNRELATED = Number(
  process.env.BENCH_UNRELATED_ROWS ?? DEFAULT_UNRELATED_ROWS,
);
const RUNS = Number(process.env.BENCH_RUNS ?? DEFAULT_RUNS);
const cases = (process.env.BENCH_CASES ?? 'ensure').split(',') as ScopedCase[];
const datasets = (process.env.BENCH_DATASETS ?? 'busy,quiet').split(
  ',',
) as DatasetKind[];
const REPORTED_FAILURES = 10;
const priceOfFirstNote = {
  tableId: NOTES,
  rowId: itemId(0),
  path: '/price',
};

describe(`scoped reading next to ${UNRELATED} changed unrelated rows`, () => {
  let kit: PartialChangesTestKit;
  let fullReadKit: PartialChangesTestKit;
  let probe: BenchProbe;
  const sources = new Map<DatasetKind, BenchBranch>();

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
    fullReadKit = await createPartialChangesTestKit({
      limits: {
        ...DEFAULT_LIMITS,
        operationTimeoutMs: Number(
          process.env.PARTIAL_CHANGES_OPERATION_TIMEOUT_MS ??
            DEFAULT_LIMITS.operationTimeoutMs,
        ),
        readScope: 'all',
      },
    });
    for (const kind of datasets) {
      sources.set(kind, await ensureScopedDataset(kit, kind));
    }
    probe = new BenchProbe(kit.prisma);
    instrumentOperations(kit, probe);
  });

  afterAll(async () => {
    await fullReadKit.close();
    await kit.close();
  });

  const runs = cases
    .filter((scopedCase) => scopedCase !== 'ensure')
    .flatMap((scopedCase) =>
      datasets.map((kind) => [scopedCase, kind] as const),
    );

  (runs.length > 0 ? it.each(runs) : it.skip.each([['ensure', 'busy']]))(
    '%s on the %s dataset',
    async (scopedCase, kind) => {
      const source = sources.get(kind as DatasetKind);
      if (!source) {
        throw new Error(`No ${kind} dataset`);
      }
      const failures: string[] = [];
      for (let run = 1; run <= RUNS; run++) {
        failures.push(
          ...(
            await measureRun(
              scopedCase as ScopedCase,
              kind as DatasetKind,
              source,
              run,
            )
          ).map((failure) => `run ${run}: ${failure}`),
        );
      }
      expect(failures.slice(0, REPORTED_FAILURES)).toEqual([]);
    },
  );

  async function measureRun(
    scopedCase: ScopedCase,
    kind: DatasetKind,
    source: BenchBranch,
    run: number,
  ): Promise<string[]> {
    const branch = await cloneBranch(
      kit.prisma,
      source,
      runProjectId(`scoped-${kind}`, `${scopedCase}-${run}`),
    );
    try {
      const before = await itemsVersions(kit, branch);
      const measurement = await probe.measure(() =>
        runCase(scopedCase, branchOf(branch)),
      );
      const { value, ...metrics } = measurement;
      const result = value as ApplyChangesResult | undefined;
      const failures = [
        ...(measurement.error ? [`error ${measurement.error}`] : []),
        ...(await outcomeFailures(
          kit,
          branch,
          { scopedCase, kind },
          result,
          before,
        )),
      ];
      emitResult({
        kind: 'scoped',
        dataset: kind,
        unrelatedChangedRows: kind === 'busy' ? UNRELATED : 0,
        operation: scopedCase,
        run,
        result: {
          status: result?.status,
          remaining: result?.remaining,
          blockers: result?.blockers?.map(({ code, message }) => ({
            code,
            message,
          })),
        },
        failures,
        ...metrics,
      });
      return failures;
    } finally {
      await dropProjects(kit.prisma, exactProject(branch.projectId));
    }
  }

  function runCase(
    scopedCase: ScopedCase,
    branch: ChangesBranch,
  ): Promise<ApplyChangesResult> {
    switch (scopedCase) {
      case 'commit-field':
        return kit.changes.commitChanges({
          branch,
          selection: { fields: [priceOfFirstNote] },
        });
      case 'revert-field':
        return kit.changes.revertChanges({
          branch,
          selection: { fields: [priceOfFirstNote] },
        });
      case 'full-read-commit-field':
        return fullReadKit.changes.commitChanges({
          branch,
          selection: { fields: [priceOfFirstNote] },
        });
      default:
        throw new Error(`Unknown case ${scopedCase}`);
    }
  }
});

async function ensureScopedDataset(
  kit: PartialChangesTestKit,
  kind: DatasetKind,
): Promise<BenchBranch> {
  const name = `scoped-${kind}-${UNRELATED}`;
  const projectId = `${BENCH_PROJECT_PREFIX}${name}`;
  const existing = await findBenchBranch(kit.prisma, projectId);
  if (existing) {
    return existing;
  }

  const started = Date.now();
  const building = await startBuilding(kit, name);
  const insertMs = await timed(async () => {
    await createItems(kit, building, UNRELATED);
    await createItems(kit, building, NOTES_ROWS, NOTES);
  });
  const nativeInitialCommitMs = await timed(() =>
    kit.draftApi.apiCreateRevision(building),
  );
  const committed = await loadBranch(kit.prisma, building.branchId);
  const changeMs = await timed(async () => {
    if (kind === 'busy') {
      await changeItems(kit, committed, UNRELATED);
    }
    await kit.draftApi.apiPatchRow({
      revisionId: committed.draftRevisionId,
      tableId: NOTES,
      rowId: itemId(0),
      patches: [{ op: 'replace', path: 'price', value: EDITED_PRICE }],
    });
  });
  await analyze(kit.prisma);

  emitResult({
    kind: 'dataset',
    dataset: name,
    unrelatedRows: UNRELATED,
    unrelatedChangedRows: kind === 'busy' ? UNRELATED : 0,
    notesRows: NOTES_ROWS,
    generationMs: Date.now() - started,
    insertMs,
    nativeInitialCommitMs,
    changeMs,
  });
  return moveToProject(kit.prisma, building.branchId, projectId);
}

interface ItemsVersions {
  head: string;
  draft: string;
}

async function itemsVersions(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
): Promise<ItemsVersions> {
  const current = await loadBranch(kit.prisma, branch.branchId);
  return {
    head: await tableVersionId(kit.prisma, current.headRevisionId, ITEMS),
    draft: await tableVersionId(kit.prisma, current.draftRevisionId, ITEMS),
  };
}

async function outcomeFailures(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  run: { scopedCase: ScopedCase; kind: DatasetKind },
  result: ApplyChangesResult | undefined,
  before: ItemsVersions,
): Promise<string[]> {
  const fullReadRefused =
    run.scopedCase === 'full-read-commit-field' &&
    run.kind === 'busy' &&
    UNRELATED > DEFAULT_LIMITS.maxChangedRows;
  if (fullReadRefused) {
    const refused =
      result?.status === 'blocked' &&
      (result.blockers ?? []).some(({ code }) => code === 'tooLarge');
    return refused ? [] : [`full read was not refused: ${result?.status}`];
  }
  const scopedCase =
    run.scopedCase === 'full-read-commit-field'
      ? 'commit-field'
      : run.scopedCase;

  const failures: string[] =
    result?.status === 'applied' ? [] : [`status ${result?.status}`];
  const after = await itemsVersions(kit, branch);
  const current = await loadBranch(kit.prisma, branch.branchId);
  if (after.draft !== before.draft) {
    failures.push('the Draft items table version changed');
  }
  if (scopedCase === 'revert-field' && after.head !== before.head) {
    failures.push('the Head items table version changed');
  }
  const price = scopedCase === 'commit-field' ? EDITED_PRICE : undefined;
  failures.push(
    ...(await notesFailures(kit, current.headRevisionId, 'head', price)),
    ...(await notesFailures(
      kit,
      current.draftRevisionId,
      'draft',
      scopedCase === 'commit-field' ? EDITED_PRICE : undefined,
    )),
  );
  return failures;
}

async function notesFailures(
  kit: PartialChangesTestKit,
  revisionId: string,
  role: 'head' | 'draft',
  firstPrice: number | undefined,
): Promise<string[]> {
  const [counts] = await kit.prisma.$queryRaw<
    { rows: number; mutable: number; formulas: number; firstPrice: number }[]
  >`
    WITH notes AS MATERIALIZED (
      SELECT r."id", r."data", r."readonly"
      FROM "_RevisionToTable" rvt
      JOIN "Table" t ON t."versionId" = rvt."B" AND t."id" = ${NOTES}
      JOIN "_RowToTable" rt ON rt."B" = t."versionId"
      JOIN "Row" r ON r."versionId" = rt."A"
      WHERE rvt."A" = ${revisionId}
    )
    SELECT count(*)::int AS "rows",
           count(*) FILTER (WHERE NOT notes."readonly")::int AS "mutable",
           count(*) FILTER (WHERE (notes."data"->>'total')::numeric IS DISTINCT FROM
             (notes."data"->>'price')::numeric * (notes."data"->>'qty')::numeric)::int AS "formulas",
           max(CASE WHEN notes."id" = ${itemId(0)} THEN (notes."data"->>'price')::int END) AS "firstPrice"
    FROM notes
  `;
  const failures: string[] = [];
  const expectedPrice = firstPrice ?? headItem(0).price;
  if (counts?.rows !== NOTES_ROWS) {
    failures.push(`${role} notes: ${counts?.rows} rows`);
  }
  if (role === 'head' && counts?.mutable !== 0) {
    failures.push(`head notes: ${counts?.mutable} mutable rows`);
  }
  if (counts?.formulas !== 0) {
    failures.push(`${role} notes: ${counts?.formulas} formula violations`);
  }
  if (counts?.firstPrice !== expectedPrice) {
    failures.push(
      `${role} notes: first price ${counts?.firstPrice}, expected ${expectedPrice}`,
    );
  }
  return failures;
}

function branchOf(branch: BenchBranch): ChangesBranch {
  return { projectId: branch.projectId, branchName: branch.branchName };
}
