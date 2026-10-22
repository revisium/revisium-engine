import { obj, str } from '@revisium/schema-toolkit/mocks';
import type { Migration } from '@revisium/schema-toolkit/types';
import { nanoid } from 'nanoid';
import objectHash from 'object-hash';
import type { InputJsonValue } from 'src/engine-prisma-types';
import {
  analyze,
  BENCH_PROJECT_PREFIX,
  BenchBranch,
  cloneBranch,
  copyTableOnWrite,
  findBenchBranch,
  loadBranch,
  moveToProject,
  tableVersionId,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import {
  createItems,
  headItem,
  ITEMS,
  itemId,
  range,
  startBuilding,
  timed,
  versionIdsById,
} from 'src/features/partial-changes-poc/__bench__/support/data-dataset';
import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import { GetMigrationsQuery } from 'src/features/revision/queries/impl/get-migrations.query';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

export const OTHER = 'other';
const OTHER_ROWS = 10;
const BATCH_SIZE = 10_000;
const EVERY_OTHER = 2;

export function structureName(rows: number, edits: boolean): string {
  return `structure-${rows}${edits ? '-edits' : ''}`;
}

export async function ensureStructureDataset(
  kit: PartialChangesTestKit,
  rows: number,
  report: (record: Record<string, unknown>) => void,
): Promise<BenchBranch> {
  const projectId = `${BENCH_PROJECT_PREFIX}${structureName(rows, false)}`;
  const existing = await findBenchBranch(kit.prisma, projectId);
  if (existing) {
    return existing;
  }

  const building = await startBuilding(kit, structureName(rows, false));
  const insertMs = await timed(() => createItems(kit, building, rows));
  await createOther(kit, building);
  await kit.draftApi.apiCreateRevision(building);
  const committed = await loadBranch(kit.prisma, building.branchId);

  await kit.draftApi.apiUpdateTable({
    revisionId: committed.draftRevisionId,
    tableId: OTHER,
    patches: [{ op: 'add', path: '/properties/size', value: str() }],
  });
  const migrateMs = await timed(() => addColorToItems(kit, committed, rows));
  await analyze(kit.prisma);

  report({
    kind: 'dataset',
    dataset: structureName(rows, false),
    rows,
    insertMs,
    migrateMs,
    pending: await pendingMigrations(kit, committed),
  });
  return moveToProject(kit.prisma, building.branchId, projectId);
}

export const ADD_COLOR = [
  { op: 'add' as const, path: '/properties/color', value: str() },
];

export function migratedItem(index: number) {
  return { ...headItem(index), color: '' };
}

async function addColorToItems(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  rows: number,
): Promise<void> {
  const head = await tableVersionId(kit.prisma, branch.headRevisionId, ITEMS);
  const draft = await copyTableOnWrite(
    kit.prisma,
    branch.draftRevisionId,
    ITEMS,
  );
  await kit.prisma.$executeRaw`
    DELETE FROM "_RowToTable" rt USING "Row" r
    WHERE rt."B" = ${draft} AND r."versionId" = rt."A" AND r."id" <> ${itemId(0)}
  `;
  await kit.draftApi.apiUpdateTable({
    revisionId: branch.draftRevisionId,
    tableId: ITEMS,
    patches: ADD_COLOR,
  });
  const migratedTable = await tableVersionId(
    kit.prisma,
    branch.draftRevisionId,
    ITEMS,
  );
  const { schemaHash } = await kit.prisma.row.findFirstOrThrow({
    where: { id: itemId(0), tables: { some: { versionId: migratedTable } } },
    select: { schemaHash: true },
  });
  await attachMigratedRows(kit.prisma, {
    head,
    draft: migratedTable,
    rows,
    schemaHash,
  });
}

async function attachMigratedRows(
  prisma: PrismaService,
  args: { head: string; draft: string; rows: number; schemaHash: string },
): Promise<void> {
  const versionIds = await versionIdsById(prisma, args.head);
  for (let start = 1; start < args.rows; start += BATCH_SIZE) {
    const indexes = range(start, Math.min(start + BATCH_SIZE, args.rows));
    const data = indexes.map(migratedItem);
    await prisma.$executeRaw`
      WITH input AS (
        SELECT * FROM unnest(
          ${indexes.map((index) => versionIds.get(itemId(index)) ?? '')}::text[],
          ${indexes.map(() => nanoid())}::text[],
          ${data.map((item) => JSON.stringify(item))}::text[],
          ${data.map((item) => objectHash(item))}::text[]
        ) AS i("previousVersionId", "versionId", "data", "hash")
      ), inserted AS (
        INSERT INTO "Row" ("versionId", "createdId", "id", "readonly", "data", "meta", "hash",
                           "schemaHash", "createdAt", "updatedAt", "publishedAt")
        SELECT i."versionId", r."createdId", r."id", false, i."data"::jsonb, r."meta", i."hash",
               ${args.schemaHash}, r."createdAt", now(), r."publishedAt"
        FROM input i JOIN "Row" r ON r."versionId" = i."previousVersionId"
        RETURNING "versionId"
      )
      INSERT INTO "_RowToTable" ("A", "B") SELECT "versionId", ${args.draft} FROM inserted
    `;
  }
}

export async function ensureStructureEditsDataset(
  kit: PartialChangesTestKit,
  base: BenchBranch,
  rows: number,
): Promise<BenchBranch> {
  const projectId = `${BENCH_PROJECT_PREFIX}${structureName(rows, true)}`;
  const existing = await findBenchBranch(kit.prisma, projectId);
  if (existing) {
    return existing;
  }

  const clone = await cloneBranch(
    kit.prisma,
    base,
    `${BENCH_PROJECT_PREFIX}building-${structureName(rows, true)}`,
  );
  const draftTable = await tableVersionId(
    kit.prisma,
    clone.draftRevisionId,
    ITEMS,
  );
  await editPricesInPlace(kit.prisma, draftTable, editedIndexes(rows));
  await analyze(kit.prisma);
  return moveToProject(kit.prisma, clone.branchId, projectId);
}

export function editedIndexes(rows: number): number[] {
  return range(0, rows).filter((index) => index % EVERY_OTHER === 0);
}

export function editedItem(index: number) {
  const { title, price, qty } = headItem(index);
  return { title, price: price + 1, qty, total: (price + 1) * qty, color: '' };
}

export async function pendingMigrations(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
): Promise<Array<Pick<Migration, 'id' | 'changeType' | 'tableId'>>> {
  const head: Migration[] = await kit.queryBus.execute(
    new GetMigrationsQuery({ revisionId: branch.headRevisionId }),
  );
  const draft: Migration[] = await kit.queryBus.execute(
    new GetMigrationsQuery({ revisionId: branch.draftRevisionId }),
  );
  const published = new Set(head.map(({ id }) => id));
  return draft
    .filter(({ id }) => !published.has(id))
    .map(({ id, changeType, tableId }) => ({ id, changeType, tableId }));
}

async function createOther(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
): Promise<void> {
  await kit.draftApi.apiCreateTable({
    revisionId: branch.draftRevisionId,
    tableId: OTHER,
    schema: obj({ label: str() }) as InputJsonValue,
  });
  await kit.draftApi.apiCreateRows({
    revisionId: branch.draftRevisionId,
    tableId: OTHER,
    rows: range(0, OTHER_ROWS).map((index) => ({
      rowId: itemId(index),
      data: { label: `label ${index}` },
    })),
  });
}

async function editPricesInPlace(
  prisma: PrismaService,
  draftTable: string,
  indexes: number[],
): Promise<void> {
  for (let start = 0; start < indexes.length; start += BATCH_SIZE) {
    const batch = indexes.slice(start, start + BATCH_SIZE);
    const data = batch.map(editedItem);
    await prisma.$executeRaw`
      WITH input AS (
        SELECT * FROM unnest(
          ${batch.map(itemId)}::text[],
          ${data.map((item) => JSON.stringify(item))}::text[],
          ${data.map((item) => objectHash(item))}::text[]
        ) AS i("id", "data", "hash")
      )
      UPDATE "Row" r
      SET "data" = i."data"::jsonb, "hash" = i."hash", "updatedAt" = now()
      FROM input i, "_RowToTable" rt
      WHERE r."id" = i."id" AND rt."A" = r."versionId" AND rt."B" = ${draftTable}
        AND NOT r."readonly"
    `;
  }
}
