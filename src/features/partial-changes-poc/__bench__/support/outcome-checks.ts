import {
  BenchBranch,
  loadBranch,
  tableVersionId,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import {
  DataDatasetSpec,
  draftItem,
  headItem,
  ITEMS,
  itemId,
} from 'src/features/partial-changes-poc/__bench__/support/data-dataset';
import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';

const HALF = 2;
const CHECK_TRANSACTION = { timeout: 600_000, maxWait: 60_000 };

interface OutcomeCounts {
  headRows: number;
  draftRows: number;
  headNewVersions: number;
  headMutableRows: number;
  draftDiffersFromHead: number;
}

export interface OutcomeCheck {
  counts: OutcomeCounts;
  expected: Partial<OutcomeCounts>;
  sample?: unknown;
  ok: boolean;
}

export async function checkOutcome(
  kit: PartialChangesTestKit,
  before: BenchBranch,
  operation: string,
  spec: DataDatasetSpec,
): Promise<OutcomeCheck> {
  const after = await loadBranch(kit.prisma, before.branchId);
  const counts = await readCounts(kit, before, after);
  const expected = expectedCounts(operation, spec);
  const sample =
    operation === 'commit-field' ? await mergedSample(kit, after) : undefined;

  const countsMatch = Object.entries(expected).every(
    ([key, value]) => counts[key as keyof OutcomeCounts] === value,
  );
  return {
    counts,
    expected,
    sample,
    ok: countsMatch && (sample === undefined || isExpectedMerge(sample)),
  };
}

function expectedCounts(
  operation: string,
  { rows, changed }: DataDatasetSpec,
): Partial<OutcomeCounts> {
  const selected = Math.ceil(changed / HALF);
  const rest = changed - selected;
  const table: Record<string, [number, number]> = {
    preview: [0, changed],
    'preview-all': [0, changed],
    'commit-rows': [selected, rest],
    'commit-field': [selected, changed],
    'revert-rows': [0, rest],
    'commit-all': [changed, 0],
    'native-commit': [changed, 0],
    'native-revert': [0, 0],
  };
  const [headNewVersions, draftDiffersFromHead] = table[operation] ?? [0, 0];
  return {
    headRows: rows,
    draftRows: rows,
    headNewVersions,
    headMutableRows: 0,
    draftDiffersFromHead,
  };
}

async function readCounts(
  kit: PartialChangesTestKit,
  before: BenchBranch,
  after: BenchBranch,
): Promise<OutcomeCounts> {
  const originalHead = await tableVersionId(
    kit.prisma,
    before.headRevisionId,
    ITEMS,
  );
  const head = await tableVersionId(kit.prisma, after.headRevisionId, ITEMS);
  const draft = await tableVersionId(kit.prisma, after.draftRevisionId, ITEMS);

  const [counts] = await kit.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL max_parallel_workers_per_gather = 0');
    return tx.$queryRaw<OutcomeCounts[]>`
    WITH h AS (
      SELECT r."createdId", r."hash", r."readonly", r."versionId"
      FROM "_RowToTable" rt JOIN "Row" r ON r."versionId" = rt."A" WHERE rt."B" = ${head}
    ), d AS (
      SELECT r."createdId", r."hash"
      FROM "_RowToTable" rt JOIN "Row" r ON r."versionId" = rt."A" WHERE rt."B" = ${draft}
    )
    SELECT
      (SELECT count(*)::int FROM h) AS "headRows",
      (SELECT count(*)::int FROM d) AS "draftRows",
      (SELECT count(*)::int FROM h WHERE NOT EXISTS (
        SELECT 1 FROM "_RowToTable" o WHERE o."B" = ${originalHead} AND o."A" = h."versionId"
      )) AS "headNewVersions",
      (SELECT count(*)::int FROM h WHERE NOT h."readonly") AS "headMutableRows",
      (SELECT count(*)::int FROM h JOIN d ON d."createdId" = h."createdId"
        WHERE d."hash" <> h."hash") AS "draftDiffersFromHead"
  `;
  }, CHECK_TRANSACTION);
  if (!counts) {
    throw new Error('No outcome counts');
  }
  return counts;
}

async function mergedSample(
  kit: PartialChangesTestKit,
  after: BenchBranch,
): Promise<unknown> {
  const row = await kit.rowApi.getRow({
    revisionId: after.headRevisionId,
    tableId: ITEMS,
    rowId: itemId(0),
  });
  return row?.data;
}

function isExpectedMerge(sample: unknown): boolean {
  const { price } = draftItem(0);
  const { qty, title } = headItem(0);
  const data = sample as Record<string, unknown>;
  return (
    data.price === price &&
    data.qty === qty &&
    data.title === title &&
    data.total === price * qty
  );
}
