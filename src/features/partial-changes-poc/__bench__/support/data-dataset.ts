import { num, numFormula, obj, str } from '@revisium/schema-toolkit/mocks';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { nanoid } from 'nanoid';
import objectHash from 'object-hash';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import type { InputJsonValue } from 'src/engine-prisma-types';
import {
  analyze,
  BENCH_PROJECT_PREFIX,
  BenchBranch,
  copyTableOnWrite,
  findBenchBranch,
  loadBranch,
  moveToProject,
  tableVersionId,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

export const ITEMS = 'items';
const BATCH_SIZE = 10_000;
const PRICE_SPREAD = 1000;
const QTY_SPREAD = 7;
const ID_DIGITS = 7;
const SUFFIX_LENGTH = 6;

export const itemSchema: JsonSchema = obj({
  title: str(),
  price: num(),
  qty: num(),
  total: numFormula('price * qty'),
});

export interface ItemData {
  title: string;
  price: number;
  qty: number;
  total: number;
  [key: string]: string | number;
}

export interface DataDatasetSpec {
  rows: number;
  changed: number;
}

export function datasetName(spec: DataDatasetSpec): string {
  return `data-${spec.rows}-${spec.changed}`;
}

export function itemId(index: number): string {
  return `r${String(index).padStart(ID_DIGITS, '0')}`;
}

export function headItem(index: number): ItemData {
  const price = (index % PRICE_SPREAD) + 1;
  const qty = (index % QTY_SPREAD) + 1;
  return { title: `item ${index}`, price, qty, total: price * qty };
}

export function draftItem(index: number): ItemData {
  const { title, price, qty } = headItem(index);
  return {
    title,
    price: price + 1,
    qty: qty + 1,
    total: (price + 1) * (qty + 1),
  };
}

export async function ensureDataDataset(
  kit: PartialChangesTestKit,
  spec: DataDatasetSpec,
  report: (record: Record<string, unknown>) => void,
): Promise<BenchBranch> {
  const projectId = `${BENCH_PROJECT_PREFIX}${datasetName(spec)}`;
  const existing = await findBenchBranch(kit.prisma, projectId);
  if (existing) {
    return existing;
  }

  const started = Date.now();
  const building = await startBuilding(kit, datasetName(spec));
  const insertMs = await timed(() => createItems(kit, building, spec.rows));
  const nativeInitialCommitMs = await timed(() =>
    kit.draftApi.apiCreateRevision(building),
  );
  const committed = await loadBranch(kit.prisma, building.branchId);
  const changeMs = await timed(() => changeItems(kit, committed, spec.changed));
  await analyze(kit.prisma);

  report({
    kind: 'dataset',
    dataset: datasetName(spec),
    ...spec,
    generationMs: Date.now() - started,
    insertMs,
    nativeInitialCommitMs,
    changeMs,
  });
  return moveToProject(kit.prisma, building.branchId, projectId);
}

export async function startBuilding(
  kit: PartialChangesTestKit,
  name: string,
): Promise<BenchBranch> {
  const graph = await prepareBranch(kit.prisma);
  return moveToProject(
    kit.prisma,
    graph.branchId,
    `${BENCH_PROJECT_PREFIX}building-${name}-${nanoid(SUFFIX_LENGTH)}`,
  );
}

export async function createItems(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  rows: number,
  tableId = ITEMS,
): Promise<void> {
  await kit.draftApi.apiCreateTable({
    revisionId: branch.draftRevisionId,
    tableId,
    schema: itemSchema as InputJsonValue,
  });
  await fillItems(kit, branch, rows, tableId);
}

export async function fillItems(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  rows: number,
  tableId = ITEMS,
): Promise<void> {
  await kit.draftApi.apiCreateRows({
    revisionId: branch.draftRevisionId,
    tableId,
    rows: [{ rowId: itemId(0), data: headItem(0) }],
  });
  const table = await tableVersionId(
    kit.prisma,
    branch.draftRevisionId,
    tableId,
  );
  const schemaHash = await nativeSchemaHash(kit.prisma, table);
  await insertCreatedRows(kit.prisma, table, rows, schemaHash);
}

export async function changeItems(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  changed: number,
  tableId = ITEMS,
): Promise<void> {
  await copyTableOnWrite(kit.prisma, branch.draftRevisionId, tableId);
  await kit.draftApi.apiPatchRow({
    revisionId: branch.draftRevisionId,
    tableId,
    rowId: itemId(0),
    patches: patchesOf(draftItem(0)),
  });
  const table = await tableVersionId(
    kit.prisma,
    branch.draftRevisionId,
    tableId,
  );
  await insertChangedVersions(kit.prisma, table, changed);
}

export function patchesOf(data: ItemData) {
  return [
    { op: 'replace' as const, path: 'price', value: data.price },
    { op: 'replace' as const, path: 'qty', value: data.qty },
  ];
}

export async function timed(
  operation: () => Promise<unknown>,
): Promise<number> {
  const started = Date.now();
  await operation();
  return Date.now() - started;
}

async function nativeSchemaHash(
  prisma: PrismaService,
  tableVersion: string,
): Promise<string> {
  const row = await prisma.row.findFirstOrThrow({
    where: { tables: { some: { versionId: tableVersion } } },
    select: { schemaHash: true },
  });
  return row.schemaHash;
}

async function insertCreatedRows(
  prisma: PrismaService,
  tableVersion: string,
  total: number,
  schemaHash: string,
): Promise<void> {
  for (let start = 1; start < total; start += BATCH_SIZE) {
    const indexes = range(start, Math.min(start + BATCH_SIZE, total));
    const data = indexes.map(headItem);
    await prisma.$executeRaw`
      WITH input AS (
        SELECT * FROM unnest(
          ${indexes.map(() => nanoid())}::text[],
          ${indexes.map(() => nanoid())}::text[],
          ${indexes.map(itemId)}::text[],
          ${data.map((item) => JSON.stringify(item))}::text[],
          ${data.map((item) => objectHash(item))}::text[]
        ) AS i("versionId", "createdId", "id", "data", "hash")
      ), inserted AS (
        INSERT INTO "Row" ("versionId", "createdId", "id", "readonly", "data", "meta", "hash", "schemaHash")
        SELECT "versionId", "createdId", "id", false, "data"::jsonb, '{}'::jsonb, "hash", ${schemaHash}
        FROM input
        RETURNING "versionId"
      )
      INSERT INTO "_RowToTable" ("A", "B") SELECT "versionId", ${tableVersion} FROM inserted
    `;
  }
}

async function insertChangedVersions(
  prisma: PrismaService,
  draftTable: string,
  changed: number,
): Promise<void> {
  const versionIds = await versionIdsById(prisma, draftTable);
  for (let start = 1; start < changed; start += BATCH_SIZE) {
    const indexes = range(start, Math.min(start + BATCH_SIZE, changed));
    const data = indexes.map(draftItem);
    await prisma.$executeRaw`
      WITH input AS (
        SELECT * FROM unnest(
          ${indexes.map((index) => versionIds.get(itemId(index)) ?? '')}::text[],
          ${indexes.map(() => nanoid())}::text[],
          ${data.map((item) => JSON.stringify(item))}::text[],
          ${data.map((item) => objectHash(item))}::text[]
        ) AS i("previousVersionId", "versionId", "data", "hash")
      ), previous AS (
        SELECT i.*, r."createdId", r."id", r."meta", r."schemaHash", r."createdAt", r."publishedAt"
        FROM input i JOIN "Row" r ON r."versionId" = i."previousVersionId"
      ), unlinked AS (
        DELETE FROM "_RowToTable" rt USING previous p
        WHERE rt."B" = ${draftTable} AND rt."A" = p."previousVersionId"
      ), inserted AS (
        INSERT INTO "Row" ("versionId", "createdId", "id", "readonly", "data", "meta", "hash",
                           "schemaHash", "createdAt", "updatedAt", "publishedAt")
        SELECT p."versionId", p."createdId", p."id", false, p."data"::jsonb, p."meta", p."hash",
               p."schemaHash", p."createdAt", now(), p."publishedAt"
        FROM previous p
        RETURNING "versionId"
      )
      INSERT INTO "_RowToTable" ("A", "B") SELECT "versionId", ${draftTable} FROM inserted
    `;
  }
}

export async function versionIdsById(
  prisma: PrismaService,
  tableVersion: string,
): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<{ id: string; versionId: string }[]>`
    SELECT r."id", r."versionId" FROM "_RowToTable" rt
    JOIN "Row" r ON r."versionId" = rt."A"
    WHERE rt."B" = ${tableVersion}
  `;
  return new Map(rows.map((row) => [row.id, row.versionId]));
}

export function range(from: number, to: number): number[] {
  return Array.from(
    { length: Math.max(0, to - from) },
    (_, index) => from + index,
  );
}
