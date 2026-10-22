import { isDeepStrictEqual } from 'node:util';
import objectHash from 'object-hash';
import {
  BenchBranch,
  loadBranch,
  tableVersionId,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import {
  createdProduct,
  createdProductId,
  editedProduct,
  FkFilesShape,
  headOrder,
  headProduct,
  notedOrder,
  noteEditIndexes,
  ORDERS,
  orderId,
  photoEditIndexes,
  photoOf,
  PRODUCTS,
  productId,
  repointedOrder,
} from 'src/features/partial-changes-poc/__bench__/support/fk-files-dataset';
import { range } from 'src/features/partial-changes-poc/__bench__/support/data-dataset';
import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import { sameJson } from 'src/features/partial-changes-poc/structure/same-json';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

export type FkFilesCase =
  | 'preview-required'
  | 'commit-required'
  | 'commit-photos'
  | 'commit-prices'
  | 'revert-required'
  | 'revert-photos'
  | 'native-commit';

type RowsById = Map<string, Record<string, unknown>>;
type RowChange = readonly [string, Record<string, unknown> | undefined];

interface ExpectedRevision {
  products: RowsById;
  orders: RowsById;
}

interface ExpectedState {
  head: ExpectedRevision;
  draft: ExpectedRevision;
  draftHasChanges: boolean;
}

interface StoredRow {
  id: string;
  data: Record<string, unknown>;
  hash: string;
  schemaHash: string;
  readonly: boolean;
}

export interface FileState {
  fileBytes: string;
  blobs: number;
}

export interface OutcomeCheck {
  failures: string[];
  rowsVerified: number;
}

const REPORTED_EXAMPLES = 3;
const CHECK_TRANSACTION = { timeout: 600_000, maxWait: 60_000 };

export function expectedStatus(benchCase: FkFilesCase): string | undefined {
  switch (benchCase) {
    case 'preview-required':
      return 'required';
    case 'native-commit':
      return undefined;
    default:
      return 'applied';
  }
}

export function expectedCounts(
  benchCase: FkFilesCase,
  shape: FkFilesShape,
): Record<string, number> | undefined {
  switch (benchCase) {
    case 'preview-required':
    case 'commit-required':
      return {
        selected: shape.deleted,
        required: shape.repointed + shape.created,
      };
    case 'revert-required':
      return {
        selected: shape.created,
        required: shape.repointed + shape.deleted,
      };
    case 'commit-photos':
    case 'commit-prices':
    case 'revert-photos':
      return { selected: shape.photoEdits, required: 0 };
    default:
      return undefined;
  }
}

export async function checkFkFilesOutcome(
  kit: PartialChangesTestKit,
  run: BenchBranch,
  benchCase: FkFilesCase,
  shape: FkFilesShape,
  input: { result: unknown; filesBefore: FileState },
): Promise<OutcomeCheck> {
  const failures = resultFailures(benchCase, shape, input.result);
  const branch = await loadBranch(kit.prisma, run.branchId);
  const expected = expectedState(benchCase, shape);
  let rowsVerified = 0;

  for (const role of ['head', 'draft'] as const) {
    const revisionId =
      role === 'head' ? branch.headRevisionId : branch.draftRevisionId;
    const products = await tableVersionId(kit.prisma, revisionId, PRODUCTS);
    const orders = await tableVersionId(kit.prisma, revisionId, ORDERS);
    for (const [tableId, versionId, rows] of [
      [PRODUCTS, products, expected[role].products],
      [ORDERS, orders, expected[role].orders],
    ] as const) {
      const stored = await readStoredRows(kit.prisma, versionId);
      rowsVerified += stored.length;
      failures.push(
        ...compareRows(`${role} ${tableId}`, stored, rows, {
          mustBeReadonly: role === 'head',
          schemaHash: await schemaHashOf(kit.prisma, revisionId, tableId),
        }),
      );
    }
    failures.push(
      ...(await sqlInvariants(kit.prisma, `${role}`, { products, orders })),
    );
  }
  failures.push(
    ...(await mutableHeadTables(kit.prisma, branch.headRevisionId)),
  );

  const draft = await kit.prisma.revision.findUniqueOrThrow({
    where: { id: branch.draftRevisionId },
  });
  if (draft.hasChanges !== expected.draftHasChanges) {
    failures.push(
      `draft hasChanges ${draft.hasChanges}, expected ${expected.draftHasChanges}`,
    );
  }
  const filesAfter = await readFileState(kit.prisma, branch.projectId);
  if (!isDeepStrictEqual(filesAfter, input.filesBefore)) {
    failures.push(
      `project file accounting changed: ${JSON.stringify(input.filesBefore)} -> ${JSON.stringify(filesAfter)}`,
    );
  }

  return { failures, rowsVerified };
}

export async function readFileState(
  prisma: PrismaService,
  projectId: string,
): Promise<FileState> {
  const [state] = await prisma.$queryRaw<FileState[]>`
    SELECT coalesce((SELECT "fileBytes" FROM "ProjectFileUsage" WHERE "projectId" = ${projectId}), 0)::text AS "fileBytes",
           (SELECT count(*)::int FROM "FileBlob" WHERE "projectId" = ${projectId} AND "deletedAt" IS NULL) AS "blobs"
  `;
  return state ?? { fileBytes: '0', blobs: 0 };
}

function resultFailures(
  benchCase: FkFilesCase,
  shape: FkFilesShape,
  result: unknown,
): string[] {
  const status = expectedStatus(benchCase);
  if (status === undefined) {
    return [];
  }
  const record = (result ?? {}) as {
    status?: string;
    applied?: Record<string, number>;
    counts?: Record<string, number>;
  };
  const failures: string[] = [];
  if (record.status !== status) {
    failures.push(`status ${record.status}, expected ${status}`);
  }
  const counts = expectedCounts(benchCase, shape);
  const actual = record.applied ?? record.counts;
  if (
    counts &&
    (actual?.selected !== counts.selected ||
      actual?.required !== counts.required)
  ) {
    failures.push(
      `counts ${JSON.stringify(actual)}, expected ${JSON.stringify(counts)}`,
    );
  }
  return failures;
}

function expectedState(
  benchCase: FkFilesCase,
  shape: FkFilesShape,
): ExpectedState {
  const head = datasetHead(shape);
  const draft = datasetDraft(shape);

  switch (benchCase) {
    case 'commit-required':
      return {
        head: {
          products: withChanges(head.products, [
            ...range(0, shape.deleted).map((index) =>
              removed(productId(index)),
            ),
            ...range(0, shape.created).map((index) =>
              replaced(createdProductId(index), createdProduct(index)),
            ),
          ]),
          orders: withChanges(
            head.orders,
            range(0, shape.repointed).map((index) =>
              replaced(orderId(index), repointedOrder(index)),
            ),
          ),
        },
        draft,
        draftHasChanges: true,
      };
    case 'commit-photos':
      return {
        head: {
          products: withChanges(
            head.products,
            photoEditIndexes(shape).map((index) =>
              replaced(productId(index), {
                ...headProduct(index),
                photo: photoOf('draft', index),
              }),
            ),
          ),
          orders: head.orders,
        },
        draft,
        draftHasChanges: true,
      };
    case 'commit-prices':
      return {
        head: {
          products: withChanges(
            head.products,
            photoEditIndexes(shape).map((index) =>
              replaced(productId(index), {
                ...editedProduct(index),
                photo: photoOf('head', index),
              }),
            ),
          ),
          orders: head.orders,
        },
        draft,
        draftHasChanges: true,
      };
    case 'revert-required':
      return {
        head,
        draft: {
          products: withChanges(draft.products, [
            ...range(0, shape.deleted).map((index) =>
              replaced(productId(index), headProduct(index)),
            ),
            ...range(0, shape.created).map((index) =>
              removed(createdProductId(index)),
            ),
          ]),
          orders: withChanges(
            draft.orders,
            range(0, shape.repointed).map((index) =>
              replaced(orderId(index), headOrder(index)),
            ),
          ),
        },
        draftHasChanges: true,
      };
    case 'revert-photos':
      return {
        head,
        draft: {
          products: withChanges(
            draft.products,
            photoEditIndexes(shape).map((index) =>
              replaced(productId(index), {
                ...editedProduct(index),
                photo: photoOf('head', index),
              }),
            ),
          ),
          orders: draft.orders,
        },
        draftHasChanges: true,
      };
    case 'native-commit':
      return { head: draft, draft, draftHasChanges: false };
    default:
      return { head, draft, draftHasChanges: true };
  }
}

function datasetHead(shape: FkFilesShape): ExpectedRevision {
  return {
    products: withChanges(
      new Map(),
      range(0, shape.products).map((index) =>
        replaced(productId(index), headProduct(index)),
      ),
    ),
    orders: withChanges(
      new Map(),
      range(0, shape.orders).map((index) =>
        replaced(orderId(index), headOrder(index)),
      ),
    ),
  };
}

function datasetDraft(shape: FkFilesShape): ExpectedRevision {
  const head = datasetHead(shape);
  return {
    products: withChanges(head.products, [
      ...range(0, shape.deleted).map((index) => removed(productId(index))),
      ...range(0, shape.created).map((index) =>
        replaced(createdProductId(index), createdProduct(index)),
      ),
      ...photoEditIndexes(shape).map((index) =>
        replaced(productId(index), editedProduct(index)),
      ),
    ]),
    orders: withChanges(head.orders, [
      ...range(0, shape.repointed).map((index) =>
        replaced(orderId(index), repointedOrder(index)),
      ),
      ...noteEditIndexes(shape).map((index) =>
        replaced(orderId(index), notedOrder(index)),
      ),
    ]),
  };
}

function removed(id: string): RowChange {
  return [id, undefined];
}

function replaced(id: string, data: Record<string, unknown>): RowChange {
  return [id, data];
}

function withChanges(rows: RowsById, changes: readonly RowChange[]): RowsById {
  const next = new Map(rows);
  for (const [id, data] of changes) {
    if (data === undefined) {
      next.delete(id);
    } else {
      next.set(id, data);
    }
  }
  return next;
}

async function readStoredRows(
  prisma: PrismaService,
  tableVersion: string,
): Promise<StoredRow[]> {
  return prisma.$queryRaw<StoredRow[]>`
    SELECT r."id", r."data", r."hash", r."schemaHash", r."readonly"
    FROM "_RowToTable" rt JOIN "Row" r ON r."versionId" = rt."A"
    WHERE rt."B" = ${tableVersion}
  `;
}

async function schemaHashOf(
  prisma: PrismaService,
  revisionId: string,
  tableId: string,
): Promise<string | undefined> {
  const [row] = await prisma.$queryRaw<{ hash: string }[]>`
    SELECT r."hash" FROM "_RevisionToTable" rvt
    JOIN "Table" t ON t."versionId" = rvt."B" AND t."id" = 'revisium_schema_table'
    JOIN "_RowToTable" rt ON rt."B" = t."versionId"
    JOIN "Row" r ON r."versionId" = rt."A" AND r."id" = ${tableId}
    WHERE rvt."A" = ${revisionId}
  `;
  return row?.hash;
}

async function mutableHeadTables(
  prisma: PrismaService,
  headRevisionId: string,
): Promise<string[]> {
  const tables = await prisma.$queryRaw<{ id: string }[]>`
    SELECT t."id" FROM "_RevisionToTable" rvt JOIN "Table" t ON t."versionId" = rvt."B"
    WHERE rvt."A" = ${headRevisionId} AND NOT t."readonly"
  `;
  return tables.length > 0
    ? [`head: mutable table versions ${tables.map(({ id }) => id).join(', ')}`]
    : [];
}

function compareRows(
  label: string,
  stored: StoredRow[],
  expected: RowsById,
  rules: { mustBeReadonly: boolean; schemaHash: string | undefined },
): string[] {
  const seen = new Set<string>();
  const problems: Record<string, string[]> = {
    unexpected: [],
    duplicate: [],
    data: [],
    hash: [],
    schemaHash: [],
    mutable: [],
  };

  for (const row of stored) {
    if (seen.has(row.id)) {
      problems.duplicate?.push(row.id);
    }
    seen.add(row.id);
    const data = expected.get(row.id);
    if (!data) {
      problems.unexpected?.push(row.id);
      continue;
    }
    if (!sameJson(row.data, data)) {
      problems.data?.push(row.id);
    }
    if (row.hash !== objectHash(row.data)) {
      problems.hash?.push(row.id);
    }
    if (row.schemaHash !== rules.schemaHash) {
      problems.schemaHash?.push(row.id);
    }
    if (rules.mustBeReadonly && !row.readonly) {
      problems.mutable?.push(row.id);
    }
  }
  problems.missing = [...expected.keys()].filter((id) => !seen.has(id));

  return Object.entries(problems)
    .filter(([, ids]) => ids.length > 0)
    .map(
      ([kind, ids]) =>
        `${label}: ${ids.length} ${kind} rows, e.g. ${ids.slice(0, REPORTED_EXAMPLES).join(', ')}`,
    );
}

async function sqlInvariants(
  prisma: PrismaService,
  label: string,
  tables: { products: string; orders: string },
): Promise<string[]> {
  const [counts] = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL max_parallel_workers_per_gather = 0');
    return tx.$queryRaw<
      { formulas: number; danglingOrders: number; filesWithoutBlob: number }[]
    >`
      WITH products AS MATERIALIZED (
        SELECT r."data" FROM "_RowToTable" rt JOIN "Row" r ON r."versionId" = rt."A"
        WHERE rt."B" = ${tables.products}
      )
      SELECT
        (SELECT count(*)::int FROM products
          WHERE (products."data"->>'total')::numeric IS DISTINCT FROM
                (products."data"->>'price')::numeric * (products."data"->>'qty')::numeric) AS "formulas",
        (SELECT count(*)::int FROM "_RowToTable" ort JOIN "Row" o ON o."versionId" = ort."A"
          WHERE ort."B" = ${tables.orders}
            AND NOT EXISTS (
              SELECT 1 FROM "_RowToTable" prt JOIN "Row" p ON p."versionId" = prt."A"
              WHERE prt."B" = ${tables.products} AND p."id" = o."data"->>'product'
            )) AS "danglingOrders",
        (SELECT count(*)::int FROM "_RowToTable" rt JOIN "Row" r ON r."versionId" = rt."A"
          WHERE rt."B" = ${tables.products}
            AND r."data"->'photo'->>'status' = 'uploaded'
            AND NOT EXISTS (
              SELECT 1 FROM "_FileBlobToRow" fbr JOIN "FileBlob" fb ON fb."id" = fbr."A"
              WHERE fbr."B" = r."versionId" AND fb."deletedAt" IS NULL
                AND fb."hash" = r."data"->'photo'->>'hash'
            )) AS "filesWithoutBlob"
    `;
  }, CHECK_TRANSACTION);

  return Object.entries(counts ?? {})
    .filter(([, count]) => count !== 0)
    .map(([name, count]) => `${label}: ${count} rows violate ${name}`);
}
