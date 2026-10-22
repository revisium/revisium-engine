import type { Migration } from '@revisium/schema-toolkit/types';
import { isDeepStrictEqual } from 'node:util';
import {
  BenchBranch,
  cloneBranch,
  moveToProject,
  dropProjects,
  exactProject,
  loadBranch,
  runProjectId,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import {
  BenchProbe,
  describeError,
  emitResult,
} from 'src/features/partial-changes-poc/__bench__/support/bench-probe';
import {
  createItems,
  fillItems,
  headItem,
  ITEMS,
  itemId,
  startBuilding,
} from 'src/features/partial-changes-poc/__bench__/support/data-dataset';
import { instrumentOperations } from 'src/features/partial-changes-poc/__bench__/support/instrumentation';
import {
  ADD_COLOR,
  editedItem,
  ensureStructureDataset,
  ensureStructureEditsDataset,
  OTHER,
  pendingMigrations,
  structureName,
} from 'src/features/partial-changes-poc/__bench__/support/structure-dataset';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import type { ChangesBranch } from 'src/features/partial-changes-poc/partial-changes.types';
import { str } from '@revisium/schema-toolkit/mocks';
import { GetMigrationsQuery } from 'src/features/revision/queries/impl/get-migrations.query';
import { SystemTables } from 'src/features/share/system-tables.consts';

type StructureCase =
  | 'ensure'
  | 'commit-structure'
  | 'commit-structure-with-edits'
  | 'revert-structure'
  | 'native-commit'
  | 'replica-sync'
  | 'async-structure';

const DEFAULT_ROWS = 100_000;
const DEFAULT_REPLICA_THRESHOLD = 1000;
const ROWS = Number(process.env.BENCH_STRUCTURE_ROWS ?? DEFAULT_ROWS);
const cases = (process.env.BENCH_CASES ?? 'ensure').split(
  ',',
) as StructureCase[];
const replicaThreshold = Number(
  process.env.BENCH_REPLICA_THRESHOLD ?? DEFAULT_REPLICA_THRESHOLD,
);
const SYNC_THRESHOLD = 1_000_000_000;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
const MIGRATION_POLL_MS = 500;
const MIGRATION_WAIT_MS = 1_800_000;

describe(`structure at scale: ${ROWS} rows`, () => {
  let kit: PartialChangesTestKit;
  let base: BenchBranch;
  let probe: BenchProbe;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({
      migrationOptions: { threshold: SYNC_THRESHOLD },
    });
    base = await ensureStructureDataset(kit, ROWS, emitResult);
    probe = new BenchProbe(kit.prisma);
    instrumentOperations(kit, probe);
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(cases)('%s', async (structureCase) => {
    if (structureCase === 'ensure') {
      emitResult({
        kind: 'verify',
        dataset: structureName(ROWS, false),
        ...(await verifyMigration(kit, base)),
      });
      const edits = await ensureStructureEditsDataset(kit, base, ROWS);
      emitResult({
        kind: 'verify',
        dataset: structureName(ROWS, true),
        ...(await verifyEdits(kit, base, edits)),
      });
      return;
    }
    if (structureCase === 'replica-sync') {
      await replicaSync(kit, base, probe);
      return;
    }
    if (structureCase === 'async-structure') {
      await asyncStructure(kit, base, probe);
      return;
    }

    const source =
      structureCase === 'commit-structure-with-edits'
        ? await ensureStructureEditsDataset(kit, base, ROWS)
        : base;
    const run = await cloneBranch(
      kit.prisma,
      source,
      runProjectId(structureName(ROWS, false), structureCase),
    );
    const pendingBefore = await pendingMigrations(kit, run);
    const measurement = await probe.measure(() =>
      runCase(kit, branchOf(run), structureCase),
    );
    const after = await loadBranch(kit.prisma, run.branchId);

    emitResult({
      kind: 'operation',
      dataset: structureName(ROWS, structureCase.endsWith('edits')),
      rows: ROWS,
      operation: structureCase,
      result: measurement.value,
      pendingBefore,
      pendingAfter: await pendingMigrations(kit, after),
      checks: measurement.error
        ? undefined
        : await structureChecks(kit, after, structureCase),
      ...withoutValue(measurement),
    });
    await dropProjects(kit.prisma, exactProject(run.projectId));
  });
});

function runCase(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  structureCase: StructureCase,
): Promise<unknown> {
  switch (structureCase) {
    case 'commit-structure':
    case 'commit-structure-with-edits':
      return kit.changes.commitChanges({
        branch,
        selection: { tables: [ITEMS] },
      });
    case 'revert-structure':
      return kit.changes.revertChanges({
        branch,
        selection: { tables: [ITEMS] },
      });
    case 'native-commit':
      return kit.draftApi.apiCreateRevision(branch);
    default:
      throw new Error(`Unknown case ${structureCase}`);
  }
}

async function structureChecks(
  kit: PartialChangesTestKit,
  after: BenchBranch,
  structureCase: StructureCase,
) {
  const sampleIndex = 0;
  const head = await kit.rowApi.getRow({
    revisionId: after.headRevisionId,
    tableId: ITEMS,
    rowId: itemId(sampleIndex),
  });
  const draft = await kit.rowApi.getRow({
    revisionId: after.draftRevisionId,
    tableId: ITEMS,
    rowId: itemId(sampleIndex),
  });
  const headSchemas = await schemaIds(kit, after.headRevisionId);
  const expectedHead =
    structureCase === 'revert-structure'
      ? headItem(sampleIndex)
      : { ...headItem(sampleIndex), color: '' };
  const expectedDraft =
    structureCase === 'commit-structure-with-edits'
      ? editedItem(sampleIndex)
      : expectedHead;
  return {
    headSample: head?.data,
    draftSample: draft?.data,
    headColor: headSchemas[ITEMS]?.includes('color') ?? false,
    ok:
      isDeepStrictEqual(head?.data, expectedHead) &&
      isDeepStrictEqual(draft?.data, expectedDraft),
  };
}

async function schemaIds(
  kit: PartialChangesTestKit,
  revisionId: string,
): Promise<Record<string, string[]>> {
  const rows = await kit.prisma.row.findMany({
    where: {
      tables: {
        some: {
          id: SystemTables.Schema,
          revisions: { some: { id: revisionId } },
        },
      },
    },
  });
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      Object.keys(
        (row.data as { properties?: Record<string, unknown> }).properties ?? {},
      ),
    ]),
  );
}

async function verifyMigration(kit: PartialChangesTestKit, base: BenchBranch) {
  const SAMPLE_ROWS = 3;
  const building = await startBuilding(kit, 'structure-control');
  await createItems(kit, building, SAMPLE_ROWS);
  await kit.draftApi.apiCreateRevision(branchOf(building));
  const control = await loadBranch(kit.prisma, building.branchId);
  await kit.draftApi.apiUpdateTable({
    revisionId: control.draftRevisionId,
    tableId: ITEMS,
    patches: ADD_COLOR,
  });
  const read = (branch: BenchBranch, revisionId: string) =>
    kit.prisma.row.findFirstOrThrow({
      where: {
        id: itemId(1),
        tables: {
          some: { id: ITEMS, revisions: { some: { id: revisionId } } },
        },
      },
    });
  const native = await read(control, control.draftRevisionId);
  const nativeHead = await read(control, control.headRevisionId);
  const generated = await read(base, base.draftRevisionId);
  const generatedHead = await read(base, base.headRevisionId);
  const mismatches = (
    ['data', 'hash', 'schemaHash', 'meta', 'readonly'] as const
  ).filter((field) => !isDeepStrictEqual(native[field], generated[field]));
  const lineage = {
    native:
      native.createdId === nativeHead.createdId &&
      native.versionId !== nativeHead.versionId,
    generated:
      generated.createdId === generatedHead.createdId &&
      generated.versionId !== generatedHead.versionId,
  };
  await dropProjects(kit.prisma, exactProject(control.projectId));
  return {
    rowId: itemId(1),
    mismatches,
    lineage,
    matches: mismatches.length === 0 && lineage.native && lineage.generated,
  };
}

async function verifyEdits(
  kit: PartialChangesTestKit,
  base: BenchBranch,
  edits: BenchBranch,
) {
  const control = await cloneBranch(
    kit.prisma,
    base,
    runProjectId(structureName(ROWS, true), 'control'),
  );
  const index = 0;
  const { price } = editedItem(index);
  await kit.draftApi.apiPatchRow({
    revisionId: control.draftRevisionId,
    tableId: ITEMS,
    rowId: itemId(index),
    patches: [{ op: 'replace', path: 'price', value: price }],
  });
  const read = (branch: BenchBranch) =>
    kit.prisma.row.findFirstOrThrow({
      where: {
        id: itemId(index),
        tables: {
          some: {
            id: ITEMS,
            revisions: { some: { id: branch.draftRevisionId } },
          },
        },
      },
    });
  const native = await read(control);
  const generated = await read(edits);
  const mismatches = (
    ['data', 'hash', 'schemaHash', 'meta', 'readonly'] as const
  ).filter((field) => !isDeepStrictEqual(native[field], generated[field]));
  await dropProjects(kit.prisma, exactProject(control.projectId));
  return { rowId: itemId(index), mismatches, matches: mismatches.length === 0 };
}

async function asyncStructure(
  kit: PartialChangesTestKit,
  base: BenchBranch,
  probe: BenchProbe,
): Promise<void> {
  const asyncKit = await createPartialChangesTestKit({
    migrationOptions: { threshold: DEFAULT_REPLICA_THRESHOLD },
  });
  const steps = new StepLog('async-structure');
  const project = await buildReplica(asyncKit, kit, base);
  steps.push({ step: 'independent project with 100k committed rows built' });
  try {
    const started = Date.now();
    const update = await asyncKit.draftApi.apiUpdateTable({
      revisionId: project.draftRevisionId,
      tableId: ITEMS,
      patches: [{ op: 'add', path: '/properties/color', value: str() }],
    });
    steps.push({
      step: 'native apiUpdateTable above the async threshold',
      migrationStatus: update.migrationStatus,
      returnedMs: Date.now() - started,
    });
    steps.push(await waitForMigrations(asyncKit, project));
    steps.push({
      step: 'pending ledger after the async migration',
      pending: await pendingMigrations(kit, project),
    });
    const preview = await probe.measure(() =>
      kit.changes.previewChanges({
        branch: branchOf(project),
        operation: 'commit',
        selection: { tables: [ITEMS] },
      }),
    );
    steps.push({
      step: 'preview of the structure commit',
      status: preview.value?.status,
      blockers: preview.value?.blockers,
      wallMs: preview.wallMs,
    });
  } finally {
    emitResult({ kind: 'async-structure', rows: ROWS, steps: steps.items });
    await asyncKit.close();
    await dropProjects(kit.prisma, exactProject(project.projectId));
  }
}

async function replicaSync(
  kit: PartialChangesTestKit,
  base: BenchBranch,
  probe: BenchProbe,
): Promise<void> {
  const source = await cloneBranch(
    kit.prisma,
    base,
    runProjectId(structureName(ROWS, false), 'replica-source'),
  );
  const replicaKit = await createPartialChangesTestKit({
    migrationOptions: { threshold: replicaThreshold },
  });
  const steps = new StepLog('replica');
  const replica = await buildReplica(replicaKit, kit, base);
  steps.push({ step: 'replica with 100k committed rows built' });

  try {
    const commit = await kit.changes.commitChanges({
      branch: branchOf(source),
      selection: { tables: [ITEMS] },
    });
    steps.push({ step: 'source partial commit of items', result: commit });

    steps.push(
      await syncStep(replicaKit, kit, source, replica, probe, 'sync 1'),
    );
    steps.push(await waitForMigrations(replicaKit, replica));
    steps.push(await replicaState(replicaKit, replica, 'after sync 1'));
    steps.push(
      await commitReplica(replicaKit, replica, 'commit after migration'),
    );
    steps.push(
      await syncStep(
        replicaKit,
        kit,
        source,
        replica,
        probe,
        'sync 2 (same Head)',
      ),
    );

    const remainder = await kit.changes.commitChanges({
      branch: branchOf(await loadBranch(kit.prisma, source.branchId)),
      selection: { tables: [OTHER] },
    });
    steps.push({
      step: 'source commit of the renumbered remainder',
      result: remainder,
    });
    steps.push(
      await syncStep(replicaKit, kit, source, replica, probe, 'sync 3'),
    );
    steps.push(await waitForMigrations(replicaKit, replica));
    steps.push(await replicaState(replicaKit, replica, 'final'));
  } finally {
    emitResult({
      kind: 'replica',
      dataset: structureName(ROWS, false),
      replicaThreshold,
      transactionTimeoutMs: Number(process.env.TRANSACTION_TIMEOUT ?? 0),
      sourceLedger: await ledgerIds(
        kit,
        await loadBranch(kit.prisma, source.branchId),
      ),
      steps: steps.items,
    });
    await replicaKit.close();
    await dropProjects(kit.prisma, exactProject(source.projectId));
    await dropProjects(kit.prisma, exactProject(replica.projectId));
  }
}

async function buildReplica(
  replicaKit: PartialChangesTestKit,
  sourceKit: PartialChangesTestKit,
  base: BenchBranch,
): Promise<BenchBranch> {
  const building = await startBuilding(replicaKit, 'replica');
  const replica = await moveToProject(
    replicaKit.prisma,
    building.branchId,
    runProjectId(structureName(ROWS, false), 'replica'),
  );
  const ledger: Migration[] = await sourceKit.queryBus.execute(
    new GetMigrationsQuery({ revisionId: base.headRevisionId }),
  );
  await replicaKit.draftApi.applyMigrations({
    revisionId: replica.draftRevisionId,
    migrations: ledger,
  });
  await fillItems(replicaKit, replica, ROWS);
  await replicaKit.draftApi.apiCreateRevision(branchOf(replica));
  return loadBranch(replicaKit.prisma, replica.branchId);
}

async function syncStep(
  replicaKit: PartialChangesTestKit,
  sourceKit: PartialChangesTestKit,
  source: BenchBranch,
  replica: BenchBranch,
  probe: BenchProbe,
  label: string,
): Promise<Record<string, unknown>> {
  const head = await loadBranch(sourceKit.prisma, source.branchId);
  const migrations: Migration[] = await sourceKit.queryBus.execute(
    new GetMigrationsQuery({ revisionId: head.headRevisionId }),
  );
  const draft = await loadBranch(replicaKit.prisma, replica.branchId);
  const measurement = await probe.measure(() =>
    replicaKit.draftApi.applyMigrations({
      revisionId: draft.draftRevisionId,
      migrations,
    }),
  );
  const applied = (measurement.value ?? []).map(({ id, status, error }) => ({
    id,
    status,
    error,
  }));
  const commit = applied.some(({ status }) => status === 'applied')
    ? await commitReplica(replicaKit, replica, `${label}: commit`)
    : undefined;
  return {
    step: label,
    applied: applied.filter(({ status }) => status !== 'skipped'),
    skipped: applied.filter(({ status }) => status === 'skipped').length,
    commit,
    ...withoutValue(measurement),
  };
}

async function commitReplica(
  replicaKit: PartialChangesTestKit,
  replica: BenchBranch,
  label: string,
): Promise<Record<string, unknown>> {
  try {
    await replicaKit.draftApi.apiCreateRevision(branchOf(replica));
    return { step: label, committed: true };
  } catch (error) {
    return { step: label, committed: false, error: describeError(error) };
  }
}

async function waitForMigrations(
  replicaKit: PartialChangesTestKit,
  replica: BenchBranch,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const branch = await loadBranch(replicaKit.prisma, replica.branchId);
  for (;;) {
    const migrations = await replicaKit.prisma.tableMigration.findMany({
      where: { revisionId: branch.draftRevisionId },
      select: { id: true, tableId: true, status: true, errorMessage: true },
    });
    const active = migrations.filter(
      ({ status }) =>
        !['COMPLETED', 'FAILED', 'CANCELLED', 'ABORTED'].includes(status),
    );
    if (active.length === 0 || Date.now() - started > MIGRATION_WAIT_MS) {
      return {
        step: 'background migrations',
        waitedMs: Date.now() - started,
        migrations,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, MIGRATION_POLL_MS));
  }
}

async function replicaState(
  replicaKit: PartialChangesTestKit,
  replica: BenchBranch,
  label: string,
): Promise<Record<string, unknown>> {
  const branch = await loadBranch(replicaKit.prisma, replica.branchId);
  return {
    step: label,
    headLedger: await ledgerIds(replicaKit, branch, 'head'),
    draftLedger: await ledgerIds(replicaKit, branch, 'draft'),
    headSchemas: await schemaIds(replicaKit, branch.headRevisionId),
    draftSchemas: await schemaIds(replicaKit, branch.draftRevisionId),
  };
}

async function ledgerIds(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  role: 'head' | 'draft' = 'head',
): Promise<string[]> {
  const migrations: Migration[] = await kit.queryBus.execute(
    new GetMigrationsQuery({
      revisionId:
        role === 'head' ? branch.headRevisionId : branch.draftRevisionId,
    }),
  );
  return migrations.map(
    ({ id, changeType, tableId }) => `${id} ${changeType} ${tableId}`,
  );
}

function branchOf(branch: BenchBranch): ChangesBranch {
  return { projectId: branch.projectId, branchName: branch.branchName };
}

function withoutValue<T extends { value?: unknown }>(
  measurement: T,
): Omit<T, 'value'> {
  const rest: Partial<T> = { ...measurement };
  delete rest.value;
  return rest as Omit<T, 'value'>;
}

class StepLog {
  readonly items: Record<string, unknown>[] = [];
  private readonly started = Date.now();

  constructor(private readonly scenario: string) {}

  push(step: Record<string, unknown>): void {
    const memory = process.memoryUsage();
    const entry = {
      ...step,
      atMs: Date.now() - this.started,
      rssMb: Math.round(memory.rss / BYTES_PER_MB),
      heapMb: Math.round(memory.heapUsed / BYTES_PER_MB),
    };
    this.items.push(entry);
    emitResult({ kind: 'step', scenario: this.scenario, ...entry });
  }
}
