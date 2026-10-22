import { ApiRevertChangesCommand } from 'src/features/draft/commands/impl/api-revert-changes.command';
import {
  BenchProbe,
  emitResult,
} from 'src/features/partial-changes-poc/__bench__/support/bench-probe';
import {
  BenchBranch,
  cloneBranch,
  dropProjects,
  exactProject,
  runProjectId,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import {
  DataDatasetSpec,
  datasetName,
  ensureDataDataset,
  ITEMS,
  itemId,
  range,
} from 'src/features/partial-changes-poc/__bench__/support/data-dataset';
import { instrumentOperations } from 'src/features/partial-changes-poc/__bench__/support/instrumentation';
import { verifyDataDataset } from 'src/features/partial-changes-poc/__bench__/support/verify-dataset';
import { checkOutcome } from 'src/features/partial-changes-poc/__bench__/support/outcome-checks';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import type {
  ChangesBranch,
  Selection,
} from 'src/features/partial-changes-poc/partial-changes.types';

export type ScaleCase =
  | 'ensure'
  | 'verify'
  | 'preview'
  | 'preview-all'
  | 'commit-rows'
  | 'commit-field'
  | 'revert-rows'
  | 'commit-all'
  | 'native-commit'
  | 'native-revert';

const spec = parseDataset(process.env.BENCH_DATASET ?? '10000x10000');
const cases = (process.env.BENCH_CASES ?? 'ensure').split(',') as ScaleCase[];
const keepRuns = process.env.BENCH_KEEP_RUNS === '1';
const EVERY_OTHER = 2;
const REPORTED_BLOCKERS = 3;

describe(`partial changes at scale: ${datasetName(spec)}`, () => {
  let kit: PartialChangesTestKit;
  let dataset: BenchBranch;
  let probe: BenchProbe;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
    dataset = await ensureDataDataset(kit, spec, emitResult);
    probe = new BenchProbe(kit.prisma);
    instrumentOperations(kit, probe);
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(cases)('%s', async (scaleCase) => {
    if (scaleCase === 'ensure') {
      return;
    }
    if (scaleCase === 'verify') {
      emitResult({
        kind: 'verify',
        dataset: datasetName(spec),
        ...(await verifyDataDataset(kit, dataset, spec)),
      });
      return;
    }

    const run = await cloneBranch(
      kit.prisma,
      dataset,
      runProjectId(datasetName(spec), scaleCase),
    );
    const selection = selectionFor(scaleCase, spec);

    const measurement = await probe.measure(() =>
      runCase(kit, run, scaleCase, selection),
    );
    const { value, ...metrics } = measurement;

    emitResult({
      kind: 'operation',
      dataset: datasetName(spec),
      ...spec,
      operation: scaleCase,
      transactionTimeoutMs: Number(process.env.TRANSACTION_TIMEOUT ?? 0),
      result: summarize(value),
      checks: measurement.error
        ? undefined
        : await checkOutcome(kit, run, scaleCase, spec),
      ...metrics,
    });

    if (!keepRuns) {
      await dropProjects(kit.prisma, exactProject(run.projectId));
    }
  });
});

function runCase(
  kit: PartialChangesTestKit,
  run: BenchBranch,
  scaleCase: ScaleCase,
  selection: Selection,
): Promise<unknown> {
  const branch: ChangesBranch = {
    projectId: run.projectId,
    branchName: run.branchName,
  };

  switch (scaleCase) {
    case 'preview':
    case 'preview-all':
      return kit.changes.previewChanges({
        branch,
        operation: 'commit',
        selection,
      });
    case 'commit-rows':
    case 'commit-field':
    case 'commit-all':
      return kit.changes.commitChanges({ branch, selection });
    case 'revert-rows':
      return kit.changes.revertChanges({ branch, selection });
    case 'native-commit':
      return kit.draftApi.apiCreateRevision(branch);
    case 'native-revert':
      return kit.commandBus.execute(new ApiRevertChangesCommand(branch));
    default:
      throw new Error(`Unknown case ${scaleCase}`);
  }
}

export function selectedIndexes(changedRows: number): number[] {
  return range(0, changedRows).filter((index) => index % EVERY_OTHER === 0);
}

function selectionFor(scaleCase: ScaleCase, dataset: DataDatasetSpec) {
  const rows = selectedIndexes(dataset.changed).map((index) => ({
    tableId: ITEMS,
    rowId: itemId(index),
  }));

  switch (scaleCase) {
    case 'commit-field':
      return { fields: rows.map((row) => ({ ...row, path: '/price' })) };
    case 'commit-all':
    case 'preview-all':
      return { all: true };
    default:
      return { rows };
  }
}

function summarize(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  if ('status' in record) {
    return {
      status: record.status,
      counts: record.counts,
      applied: record.applied,
      remaining: record.remaining,
      blockers: (record.blockers as unknown[] | undefined)?.slice(
        0,
        REPORTED_BLOCKERS,
      ),
      required: (record.required as unknown[] | undefined)?.length,
    };
  }
  return { native: true };
}

function parseDataset(value: string): DataDatasetSpec {
  const [rows, changed] = value.split('x').map(Number);
  if (!rows || changed === undefined || Number.isNaN(changed)) {
    throw new Error(`BENCH_DATASET must look like 100000x100000: ${value}`);
  }
  return { rows, changed };
}
