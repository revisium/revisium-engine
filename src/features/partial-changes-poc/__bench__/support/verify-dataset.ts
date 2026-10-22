import { isDeepStrictEqual } from 'node:util';
import objectHash from 'object-hash';
import {
  BenchBranch,
  loadBranch,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import {
  DataDatasetSpec,
  draftItem,
  headItem,
  ITEMS,
  itemId,
  itemSchema,
  patchesOf,
  startBuilding,
} from 'src/features/partial-changes-poc/__bench__/support/data-dataset';
import type { InputJsonValue } from 'src/engine-prisma-types';
import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';

const HALF = 2;

interface StoredVersion {
  versionId: string;
  createdId: string;
  readonly: boolean;
  data: unknown;
  meta: unknown;
  hash: string;
  schemaHash: string;
  createdAt: Date;
  publishedAt: Date;
}

interface SampleComparison {
  rowId: string;
  role: 'head' | 'draft';
  mismatches: string[];
}

export interface DatasetVerification {
  sampledRows: string[];
  comparisons: SampleComparison[];
  nativeRowsSummary: unknown;
  expectedModified: number;
  matches: boolean;
}

export async function verifyDataDataset(
  kit: PartialChangesTestKit,
  dataset: BenchBranch,
  spec: DataDatasetSpec,
): Promise<DatasetVerification> {
  const indexes = sampleIndexes(spec);
  const control = await buildNativeControl(kit, indexes, spec.changed);
  const comparisons: SampleComparison[] = [];

  for (const index of indexes) {
    for (const role of ['head', 'draft'] as const) {
      const generated = await storedVersion(kit, dataset, role, itemId(index));
      const native = await storedVersion(kit, control, role, itemId(index));
      comparisons.push({
        rowId: itemId(index),
        role,
        mismatches: compareVersions(generated, native),
      });
    }
    comparisons.push({
      rowId: itemId(index),
      role: 'draft',
      mismatches: await compareLineage(kit, dataset, control, itemId(index)),
    });
  }

  const summary = await kit.revisionChanges.revisionChanges({
    revisionId: dataset.draftRevisionId,
  });
  return {
    sampledRows: indexes.map(itemId),
    comparisons: comparisons.filter(
      (comparison) => comparison.mismatches.length > 0,
    ),
    nativeRowsSummary: summary.rowsSummary,
    expectedModified: spec.changed,
    matches:
      comparisons.every((comparison) => comparison.mismatches.length === 0) &&
      summary.rowsSummary.modified === spec.changed,
  };
}

function sampleIndexes(spec: DataDatasetSpec): number[] {
  const half = Math.floor(spec.changed / HALF);
  return [
    ...new Set([0, 1, half, spec.changed - 1, spec.changed, spec.rows - 1]),
  ].filter((index) => index >= 0 && index < spec.rows);
}

async function buildNativeControl(
  kit: PartialChangesTestKit,
  indexes: number[],
  changed: number,
): Promise<BenchBranch> {
  const control = await startBuilding(kit, 'control');
  await kit.draftApi.apiCreateTable({
    revisionId: control.draftRevisionId,
    tableId: ITEMS,
    schema: itemSchema as InputJsonValue,
  });
  await kit.draftApi.apiCreateRows({
    revisionId: control.draftRevisionId,
    tableId: ITEMS,
    rows: indexes.map((index) => ({
      rowId: itemId(index),
      data: headItem(index),
    })),
  });
  await kit.draftApi.apiCreateRevision(control);
  const committed = await loadBranch(kit.prisma, control.branchId);

  for (const index of indexes.filter((candidate) => candidate < changed)) {
    await kit.draftApi.apiPatchRow({
      revisionId: committed.draftRevisionId,
      tableId: ITEMS,
      rowId: itemId(index),
      patches: patchesOf(draftItem(index)),
    });
  }
  return committed;
}

async function storedVersion(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  role: 'head' | 'draft',
  rowId: string,
): Promise<StoredVersion> {
  const revisionId =
    role === 'head' ? branch.headRevisionId : branch.draftRevisionId;
  const native = await kit.rowApi.getRow({ revisionId, tableId: ITEMS, rowId });
  const stored = await kit.prisma.row.findFirstOrThrow({
    where: {
      id: rowId,
      tables: {
        some: { id: ITEMS, revisions: { some: { id: revisionId } } },
      },
    },
  });
  if (!native || !isDeepStrictEqual(native.data, stored.data)) {
    throw new Error(`Native read of ${role} ${rowId} differs from storage`);
  }
  return stored;
}

function compareVersions(
  generated: StoredVersion,
  native: StoredVersion,
): string[] {
  const mismatches: string[] = [];
  const fields = ['readonly', 'data', 'meta', 'hash', 'schemaHash'] as const;
  for (const field of fields) {
    if (!isDeepStrictEqual(generated[field], native[field])) {
      mismatches.push(field);
    }
  }
  if (generated.hash !== objectHash(generated.data as object)) {
    mismatches.push('hash != objectHash(data)');
  }
  return mismatches;
}

async function compareLineage(
  kit: PartialChangesTestKit,
  dataset: BenchBranch,
  control: BenchBranch,
  rowId: string,
): Promise<string[]> {
  const lineage = async (branch: BenchBranch) => {
    const head = await storedVersion(kit, branch, 'head', rowId);
    const draft = await storedVersion(kit, branch, 'draft', rowId);
    return {
      sameVersion: head.versionId === draft.versionId,
      sameCreatedId: head.createdId === draft.createdId,
      sameCreatedAt: head.createdAt.getTime() === draft.createdAt.getTime(),
      samePublishedAt:
        head.publishedAt.getTime() === draft.publishedAt.getTime(),
    };
  };
  const generated = await lineage(dataset);
  const native = await lineage(control);
  return Object.entries(generated)
    .filter(([key, value]) => native[key as keyof typeof native] !== value)
    .map(([key]) => `lineage.${key}`);
}
