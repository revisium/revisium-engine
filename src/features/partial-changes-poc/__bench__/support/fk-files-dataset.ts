import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { num, numFormula, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
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
import {
  range,
  timed,
  versionIdsById,
} from 'src/features/partial-changes-poc/__bench__/support/data-dataset';
import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

export const PRODUCTS = 'products';
export const ORDERS = 'orders';

const BATCH_SIZE = 10_000;
const ID_DIGITS = 7;
const PRICE_SPREAD = 1000;
const CREATED_PRICE_SPREAD = 500;
const QTY_SPREAD = 7;
const ORDER_QTY_SPREAD = 5;
const FILE_SIZE = 1000;
const FILE_ID_LENGTH = 21;
const FILE_HASH_LENGTH = 40;
const SUFFIX_LENGTH = 6;
const SHARE_DELETED = 0.1;
const SHARE_PHOTO_EDITS = 0.3;
const SHARE_NOTE_EDITS = 0.4;

export const productSchema: JsonSchema = obj({
  title: str(),
  price: num(),
  qty: num(),
  total: numFormula('price * qty'),
  photo: ref(SystemSchemaIds.File),
});

export const orderSchema: JsonSchema = obj({
  product: str({ foreignKey: PRODUCTS }),
  note: str(),
  qty: num(),
});

export interface FkFilesSpec {
  changed: number;
}

export interface FkFilesShape {
  products: number;
  orders: number;
  deleted: number;
  created: number;
  repointed: number;
  photoEdits: number;
  noteEdits: number;
}

export type Photo = Record<string, string | number>;
export type ProductData = Record<string, string | number | Photo>;
export type OrderData = Record<string, string | number>;

export function shapeOf(spec: FkFilesSpec): FkFilesShape {
  const deleted = Math.round(spec.changed * SHARE_DELETED);
  return {
    products: spec.changed,
    orders: spec.changed,
    deleted,
    created: deleted,
    repointed: deleted,
    photoEdits: Math.round(spec.changed * SHARE_PHOTO_EDITS),
    noteEdits: Math.round(spec.changed * SHARE_NOTE_EDITS),
  };
}

export function fkFilesName(spec: FkFilesSpec): string {
  return `fkfiles-${spec.changed}`;
}

export function productId(index: number): string {
  return `p${String(index).padStart(ID_DIGITS, '0')}`;
}

export function createdProductId(index: number): string {
  return `n${String(index).padStart(ID_DIGITS, '0')}`;
}

export function orderId(index: number): string {
  return `o${String(index).padStart(ID_DIGITS, '0')}`;
}

export function photoOf(kind: string, index: number): Photo {
  const seed = `${kind}-${index}`;
  return {
    status: 'uploaded',
    fileId: createHash('sha256')
      .update(`file-${seed}`)
      .digest('base64url')
      .slice(0, FILE_ID_LENGTH),
    url: '',
    fileName: `${seed}.txt`,
    hash: createHash('sha256')
      .update(seed)
      .digest('hex')
      .slice(0, FILE_HASH_LENGTH),
    extension: 'txt',
    mimeType: 'text/plain',
    size: FILE_SIZE,
    width: 0,
    height: 0,
  };
}

export function headProduct(index: number): ProductData {
  const price = (index % PRICE_SPREAD) + 1;
  const qty = (index % QTY_SPREAD) + 1;
  return {
    title: `product ${index}`,
    price,
    qty,
    total: price * qty,
    photo: photoOf('head', index),
  };
}

export function editedProduct(index: number): ProductData {
  const head = headProduct(index);
  const price = (head.price as number) + 1;
  return {
    ...head,
    price,
    total: price * (head.qty as number),
    photo: photoOf('draft', index),
  };
}

export function createdProduct(index: number): ProductData {
  const price = (index % CREATED_PRICE_SPREAD) + 1;
  return {
    title: `new product ${index}`,
    price,
    qty: 1,
    total: price,
    photo: photoOf('created', index),
  };
}

export function headOrder(index: number): OrderData {
  return {
    product: productId(index),
    note: '',
    qty: (index % ORDER_QTY_SPREAD) + 1,
  };
}

export function repointedOrder(index: number): OrderData {
  return { ...headOrder(index), product: createdProductId(index) };
}

export function notedOrder(index: number): OrderData {
  return { ...headOrder(index), note: 'edited' };
}

export function photoEditIndexes(shape: FkFilesShape): number[] {
  return range(shape.deleted, shape.deleted + shape.photoEdits);
}

export function noteEditIndexes(shape: FkFilesShape): number[] {
  return range(shape.repointed, shape.repointed + shape.noteEdits);
}

export async function ensureFkFilesDataset(
  kit: PartialChangesTestKit,
  spec: FkFilesSpec,
  report: (record: Record<string, unknown>) => void,
): Promise<BenchBranch> {
  const projectId = `${BENCH_PROJECT_PREFIX}${fkFilesName(spec)}`;
  const existing = await findBenchBranch(kit.prisma, projectId);
  if (existing) {
    return existing;
  }

  const shape = shapeOf(spec);
  const started = Date.now();
  const graph = await prepareBranch(kit.prisma);
  const building = await moveToProject(
    kit.prisma,
    graph.branchId,
    `${projectId}-building-${nanoid(SUFFIX_LENGTH)}`,
  );
  const insertMs = await timed(() => createHeadRows(kit, building, shape));
  const nativeInitialCommitMs = await timed(() =>
    kit.draftApi.apiCreateRevision(building),
  );
  const committed = await loadBranch(kit.prisma, building.branchId);
  const changeMs = await timed(() => changeDraft(kit, committed, shape));
  await assignFilesToProject(kit.prisma, committed.projectId, projectId);
  await analyze(kit.prisma);

  report({
    kind: 'dataset',
    dataset: fkFilesName(spec),
    ...shape,
    generationMs: Date.now() - started,
    insertMs,
    nativeInitialCommitMs,
    changeMs,
  });
  return moveToProject(kit.prisma, building.branchId, projectId);
}

async function createHeadRows(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  shape: FkFilesShape,
): Promise<void> {
  const products = await createTableWithFirstRow(kit, branch, {
    tableId: PRODUCTS,
    schema: productSchema,
    rowId: productId(0),
    data: { ...headProduct(0), photo: emptyPhoto() },
  });
  await replaceRowData(kit.prisma, products, productId(0), headProduct(0));
  await attachFiles(kit.prisma, branch.projectId, products, [
    { rowId: productId(0), photo: headProduct(0).photo as Photo },
  ]);
  await insertRows(kit.prisma, branch.projectId, products.versionId, {
    ids: range(1, shape.products).map(productId),
    dataOf: (rowIndex) => headProduct(rowIndex + 1),
    schemaHash: products.schemaHash,
  });

  const orders = await createTableWithFirstRow(kit, branch, {
    tableId: ORDERS,
    schema: orderSchema,
    rowId: orderId(0),
    data: headOrder(0),
  });
  await insertRows(kit.prisma, branch.projectId, orders.versionId, {
    ids: range(1, shape.orders).map(orderId),
    dataOf: (rowIndex) => headOrder(rowIndex + 1),
    schemaHash: orders.schemaHash,
  });
}

async function changeDraft(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  shape: FkFilesShape,
): Promise<void> {
  await copyTableOnWrite(kit.prisma, branch.draftRevisionId, PRODUCTS);
  await copyTableOnWrite(kit.prisma, branch.draftRevisionId, ORDERS);
  const products = await draftTable(kit, branch, PRODUCTS);
  const orders = await draftTable(kit, branch, ORDERS);

  await unlinkRows(
    kit.prisma,
    products.versionId,
    range(0, shape.deleted).map(productId),
  );
  await insertRows(kit.prisma, branch.projectId, products.versionId, {
    ids: range(0, shape.created).map(createdProductId),
    dataOf: createdProduct,
    schemaHash: products.schemaHash,
  });
  await replaceVersions(kit.prisma, branch.projectId, products.versionId, {
    indexes: photoEditIndexes(shape),
    idOf: productId,
    dataOf: editedProduct,
  });
  await replaceVersions(kit.prisma, branch.projectId, orders.versionId, {
    indexes: range(0, shape.repointed),
    idOf: orderId,
    dataOf: repointedOrder,
  });
  await replaceVersions(kit.prisma, branch.projectId, orders.versionId, {
    indexes: noteEditIndexes(shape),
    idOf: orderId,
    dataOf: notedOrder,
  });
  await kit.prisma.revision.update({
    where: { id: branch.draftRevisionId },
    data: { hasChanges: true },
  });
}

interface TableHandle {
  versionId: string;
  schemaHash: string;
}

async function createTableWithFirstRow(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  input: {
    tableId: string;
    schema: JsonSchema;
    rowId: string;
    data: Record<string, unknown>;
  },
): Promise<TableHandle> {
  await kit.draftApi.apiCreateTable({
    revisionId: branch.draftRevisionId,
    tableId: input.tableId,
    schema: input.schema as InputJsonValue,
  });
  await kit.draftApi.apiCreateRows({
    revisionId: branch.draftRevisionId,
    tableId: input.tableId,
    rows: [{ rowId: input.rowId, data: input.data as InputJsonValue }],
  });
  return draftTable(kit, branch, input.tableId);
}

async function draftTable(
  kit: PartialChangesTestKit,
  branch: BenchBranch,
  tableId: string,
): Promise<TableHandle> {
  const versionId = await tableVersionId(
    kit.prisma,
    branch.draftRevisionId,
    tableId,
  );
  const row = await kit.prisma.row.findFirstOrThrow({
    where: { tables: { some: { versionId } } },
    select: { schemaHash: true },
  });
  return { versionId, schemaHash: row.schemaHash };
}

async function replaceRowData(
  prisma: PrismaService,
  table: TableHandle,
  rowId: string,
  data: ProductData,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Row" r SET "data" = ${JSON.stringify(data)}::jsonb, "hash" = ${objectHash(data)}
    FROM "_RowToTable" rt
    WHERE rt."A" = r."versionId" AND rt."B" = ${table.versionId} AND r."id" = ${rowId}
  `;
}

async function insertRows(
  prisma: PrismaService,
  projectId: string,
  tableVersion: string,
  input: {
    ids: string[];
    dataOf: (index: number) => Record<string, unknown>;
    schemaHash: string;
  },
): Promise<void> {
  for (let start = 0; start < input.ids.length; start += BATCH_SIZE) {
    const indexes = range(
      start,
      Math.min(start + BATCH_SIZE, input.ids.length),
    );
    const data = indexes.map(input.dataOf);
    const versionIds = indexes.map(() => nanoid());
    await prisma.$executeRaw`
      WITH input AS (
        SELECT * FROM unnest(
          ${versionIds}::text[],
          ${indexes.map(() => nanoid())}::text[],
          ${indexes.map((index) => input.ids[index] ?? '')}::text[],
          ${data.map((item) => JSON.stringify(item))}::text[],
          ${data.map((item) => objectHash(item))}::text[]
        ) AS i("versionId", "createdId", "id", "data", "hash")
      ), inserted AS (
        INSERT INTO "Row" ("versionId", "createdId", "id", "readonly", "data", "meta", "hash", "schemaHash")
        SELECT "versionId", "createdId", "id", false, "data"::jsonb, '{}'::jsonb, "hash", ${input.schemaHash}
        FROM input
        RETURNING "versionId"
      )
      INSERT INTO "_RowToTable" ("A", "B") SELECT "versionId", ${tableVersion} FROM inserted
    `;
    await attachFilesToVersions(
      prisma,
      projectId,
      versionIds.map((versionId, offset) => ({
        versionId,
        photo: data[offset]?.photo as Photo | undefined,
      })),
    );
  }
}

async function replaceVersions(
  prisma: PrismaService,
  projectId: string,
  draftTableVersion: string,
  input: {
    indexes: number[];
    idOf: (index: number) => string;
    dataOf: (index: number) => Record<string, unknown>;
  },
): Promise<void> {
  const versionIds = await versionIdsById(prisma, draftTableVersion);
  for (let start = 0; start < input.indexes.length; start += BATCH_SIZE) {
    const indexes = input.indexes.slice(start, start + BATCH_SIZE);
    const data = indexes.map(input.dataOf);
    const nextVersionIds = indexes.map(() => nanoid());
    await prisma.$executeRaw`
      WITH input AS (
        SELECT * FROM unnest(
          ${indexes.map((index) => versionIds.get(input.idOf(index)) ?? '')}::text[],
          ${nextVersionIds}::text[],
          ${data.map((item) => JSON.stringify(item))}::text[],
          ${data.map((item) => objectHash(item))}::text[]
        ) AS i("previousVersionId", "versionId", "data", "hash")
      ), previous AS (
        SELECT i.*, r."createdId", r."id", r."meta", r."schemaHash", r."createdAt", r."publishedAt"
        FROM input i JOIN "Row" r ON r."versionId" = i."previousVersionId"
      ), unlinked AS (
        DELETE FROM "_RowToTable" rt USING previous p
        WHERE rt."B" = ${draftTableVersion} AND rt."A" = p."previousVersionId"
      ), inserted AS (
        INSERT INTO "Row" ("versionId", "createdId", "id", "readonly", "data", "meta", "hash",
                           "schemaHash", "createdAt", "updatedAt", "publishedAt")
        SELECT p."versionId", p."createdId", p."id", false, p."data"::jsonb, p."meta", p."hash",
               p."schemaHash", p."createdAt", now(), p."publishedAt"
        FROM previous p
        RETURNING "versionId"
      )
      INSERT INTO "_RowToTable" ("A", "B") SELECT "versionId", ${draftTableVersion} FROM inserted
    `;
    await attachFilesToVersions(
      prisma,
      projectId,
      nextVersionIds.map((versionId, offset) => ({
        versionId,
        photo: data[offset]?.photo as Photo | undefined,
      })),
    );
  }
}

async function unlinkRows(
  prisma: PrismaService,
  tableVersion: string,
  rowIds: string[],
): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "_RowToTable" rt USING "Row" r
    WHERE rt."A" = r."versionId" AND rt."B" = ${tableVersion} AND r."id" = ANY(${rowIds}::text[])
  `;
}

async function attachFiles(
  prisma: PrismaService,
  projectId: string,
  table: TableHandle,
  rows: Array<{ rowId: string; photo: Photo }>,
): Promise<void> {
  const versionIds = await versionIdsById(prisma, table.versionId);
  await attachFilesToVersions(
    prisma,
    projectId,
    rows.map(({ rowId, photo }) => ({
      versionId: versionIds.get(rowId) ?? '',
      photo,
    })),
  );
}

async function attachFilesToVersions(
  prisma: PrismaService,
  projectId: string,
  rows: Array<{ versionId: string; photo: Photo | undefined }>,
): Promise<void> {
  const files = rows.filter(
    (row): row is { versionId: string; photo: Photo } =>
      row.photo?.status === 'uploaded',
  );
  if (files.length === 0) {
    return;
  }
  const blobIds = files.map(() => nanoid());
  await prisma.$executeRaw`
    INSERT INTO "FileBlob" ("id", "projectId", "hash", "size")
    SELECT * FROM unnest(
      ${blobIds}::text[],
      ${files.map(() => projectId)}::text[],
      ${files.map(({ photo }) => String(photo.hash))}::text[],
      ${files.map(({ photo }) => Number(photo.size))}::bigint[]
    )
  `;
  await prisma.$executeRaw`
    INSERT INTO "_FileBlobToRow" ("A", "B")
    SELECT * FROM unnest(${blobIds}::text[], ${files.map(({ versionId }) => versionId)}::text[])
  `;
  const bytes = files.reduce((sum, { photo }) => sum + Number(photo.size), 0);
  await prisma.projectFileUsage.upsert({
    where: { projectId },
    create: { projectId, fileBytes: BigInt(bytes) },
    update: { fileBytes: { increment: BigInt(bytes) } },
  });
}

async function assignFilesToProject(
  prisma: PrismaService,
  fromProjectId: string,
  toProjectId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "FileBlob" SET "projectId" = ${toProjectId} WHERE "projectId" = ${fromProjectId}
  `;
  await prisma.$executeRaw`
    UPDATE "ProjectFileUsage" SET "projectId" = ${toProjectId} WHERE "projectId" = ${fromProjectId}
  `;
}

function emptyPhoto(): Photo {
  return {
    status: '',
    fileId: '',
    url: '',
    fileName: '',
    hash: '',
    extension: '',
    mimeType: '',
    size: 0,
    width: 0,
    height: 0,
  };
}
