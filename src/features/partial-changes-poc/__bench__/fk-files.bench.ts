import { nanoid } from 'nanoid';
import {
  BenchBranch,
  cloneBranchInProject,
  dropBranch,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import {
  BenchProbe,
  emitResult,
} from 'src/features/partial-changes-poc/__bench__/support/bench-probe';
import { range } from 'src/features/partial-changes-poc/__bench__/support/data-dataset';
import {
  checkFkFilesOutcome,
  FkFilesCase,
  readFileState,
} from 'src/features/partial-changes-poc/__bench__/support/fk-files-checks';
import {
  createdProductId,
  ensureFkFilesDataset,
  FkFilesShape,
  fkFilesName,
  photoEditIndexes,
  PRODUCTS,
  productId,
  shapeOf,
} from 'src/features/partial-changes-poc/__bench__/support/fk-files-dataset';
import { instrumentOperations } from 'src/features/partial-changes-poc/__bench__/support/instrumentation';
import { LinkWriteRecorder } from 'src/features/partial-changes-poc/__bench__/support/link-writes';
import { verifyFkFilesDataset } from 'src/features/partial-changes-poc/__bench__/support/verify-fk-files';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import type {
  ChangeOperation,
  ChangesBranch,
  OperationEstimate,
  Selection,
} from 'src/features/partial-changes-poc/partial-changes.types';
import { tooLargeBlockers } from 'src/features/partial-changes-poc/planning/operation-estimator.service';
import { DEFAULT_LIMITS } from 'src/features/partial-changes-poc/planning/operation-limits.service';

type BenchCase = 'ensure' | 'verify' | FkFilesCase;

interface PreparedCase {
  expected?: string;
  estimate?: OperationEstimate;
}

const DEFAULT_CHANGED = 10_000;
const DEFAULT_RUNS = 3;
const REPORTED_BLOCKERS = 3;
const spec = {
  changed: Number(process.env.BENCH_CHANGED ?? DEFAULT_CHANGED),
};
const shape = shapeOf(spec);
const cases = (process.env.BENCH_CASES ?? 'ensure').split(',') as BenchCase[];
const runs = Number(process.env.BENCH_RUNS ?? DEFAULT_RUNS);
const NO_LIMITS = {
  maxChangedRows: Number.MAX_SAFE_INTEGER,
  maxMixedTableLinks: Number.MAX_SAFE_INTEGER,
  maxFormulaMerges: Number.MAX_SAFE_INTEGER,
};
const RUN_SUFFIX = 6;
const REPORTED_FAILURES = 10;

describe(`FK, files and required units at scale: ${fkFilesName(spec)}`, () => {
  let kit: PartialChangesTestKit;
  let dataset: BenchBranch;
  let probe: BenchProbe;
  let linkWrites: LinkWriteRecorder;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({ limits: NO_LIMITS });
    dataset = await ensureFkFilesDataset(kit, spec, emitResult);
    probe = new BenchProbe(kit.prisma);
    instrumentOperations(kit, probe);
    linkWrites = new LinkWriteRecorder(kit);
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(cases)('%s', async (benchCase) => {
    if (benchCase === 'ensure') {
      return;
    }
    if (benchCase === 'verify') {
      const verification = await verifyFkFilesDataset(kit, dataset, shape);
      emitResult({
        kind: 'verify',
        dataset: fkFilesName(spec),
        ...verification,
      });
      expect(verification.comparisons).toEqual([]);
      expect(verification.matches).toBe(true);
      return;
    }

    const failures: string[] = [];
    for (let run = 1; run <= runs; run++) {
      failures.push(
        ...(await measureRun(benchCase, run)).map(
          (failure) => `run ${run}: ${failure}`,
        ),
      );
    }
    expect(failures.slice(0, REPORTED_FAILURES)).toEqual([]);
  });

  async function measureRun(
    benchCase: FkFilesCase,
    run: number,
  ): Promise<string[]> {
    const branch = await cloneBranchInProject(
      kit.prisma,
      dataset,
      `run-${benchCase}-${nanoid(RUN_SUFFIX)}`,
    );
    try {
      const prepared = await prepareCase(kit, branch, benchCase);
      const filesBefore = await readFileState(kit.prisma, branch.projectId);
      linkWrites.reset();
      const measurement = await probe.measure(() =>
        runCase(kit, branch, benchCase, prepared),
      );
      const writes = await linkWrites.report(kit.prisma);
      const { value, ...metrics } = measurement;
      const estimate = prepared.estimate ?? estimateOf(value);
      const checks = measurement.error
        ? { failures: [measurement.error], rowsVerified: 0 }
        : await checkFkFilesOutcome(kit, branch, benchCase, shape, {
            result: value,
            filesBefore,
          });

      emitResult({
        kind: 'operation',
        dataset: fkFilesName(spec),
        ...shape,
        operation: benchCase,
        run,
        result: summarize(value),
        estimate,
        refusedByDefaultLimits: estimate
          ? tooLargeBlockers(estimate, DEFAULT_LIMITS).map(
              (blocker) => blocker.message,
            )
          : undefined,
        linkWrites: writes,
        checks,
        ...metrics,
      });
      return checks.failures;
    } finally {
      await dropBranch(kit.prisma, branch.branchId);
    }
  }
});

async function prepareCase(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  benchCase: FkFilesCase,
): Promise<PreparedCase> {
  const plan = planOf(benchCase);
  if (!plan || benchCase === 'preview-required') {
    return {};
  }
  const preview = await kit.changes.previewChanges({
    branch: publicBranch(branch),
    operation: plan.operation,
    selection: plan.selection,
    includeRequired: plan.includeRequired,
  });
  return {
    expected: plan.includeRequired ? preview.fingerprint : undefined,
    estimate: preview.estimate,
  };
}

function runCase(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  benchCase: FkFilesCase,
  prepared: PreparedCase,
): Promise<unknown> {
  const plan = planOf(benchCase);
  const target = publicBranch(branch);
  if (!plan) {
    return kit.draftApi.apiCreateRevision(target);
  }
  if (benchCase === 'preview-required') {
    return kit.changes.previewChanges({
      branch: target,
      operation: plan.operation,
      selection: plan.selection,
    });
  }
  const input = {
    branch: target,
    selection: plan.selection,
    includeRequired: plan.includeRequired,
    expected: prepared.expected,
  };
  return plan.operation === 'commit'
    ? kit.changes.commitChanges(input)
    : kit.changes.revertChanges(input);
}

function planOf(benchCase: FkFilesCase):
  | {
      operation: ChangeOperation;
      selection: Selection;
      includeRequired?: boolean;
    }
  | undefined {
  switch (benchCase) {
    case 'preview-required':
    case 'commit-required':
      return {
        operation: 'commit',
        selection: { rows: deletedProducts(shape) },
        includeRequired: true,
      };
    case 'revert-required':
      return {
        operation: 'revert',
        selection: { rows: createdProducts(shape) },
        includeRequired: true,
      };
    case 'commit-photos':
      return { operation: 'commit', selection: { fields: photoFields(shape) } };
    case 'commit-prices':
      return {
        operation: 'commit',
        selection: { fields: photoFields(shape, '/price') },
      };
    case 'revert-photos':
      return { operation: 'revert', selection: { fields: photoFields(shape) } };
    default:
      return undefined;
  }
}

function deletedProducts(current: FkFilesShape) {
  return range(0, current.deleted).map((index) => ({
    tableId: PRODUCTS,
    rowId: productId(index),
  }));
}

function createdProducts(current: FkFilesShape) {
  return range(0, current.created).map((index) => ({
    tableId: PRODUCTS,
    rowId: createdProductId(index),
  }));
}

function photoFields(current: FkFilesShape, path = '/photo') {
  return photoEditIndexes(current).map((index) => ({
    tableId: PRODUCTS,
    rowId: productId(index),
    path,
  }));
}

function publicBranch(branch: BenchBranch): ChangesBranch {
  return { projectId: branch.projectId, branchName: branch.branchName };
}

function estimateOf(value: unknown): OperationEstimate | undefined {
  return (value as { estimate?: OperationEstimate } | undefined)?.estimate;
}

function summarize(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (!('status' in record)) {
    return { native: true };
  }
  return {
    status: record.status,
    counts: record.counts,
    applied: record.applied,
    remaining: record.remaining,
    required: (record.required as unknown[] | undefined)?.length,
    blockers: (record.blockers as unknown[] | undefined)?.slice(
      0,
      REPORTED_BLOCKERS,
    ),
  };
}
