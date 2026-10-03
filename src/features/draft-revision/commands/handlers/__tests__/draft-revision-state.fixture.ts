import { nanoid } from 'nanoid';
import { Prisma } from 'src/__generated__/client';
import type { JsonValue } from 'src/engine-prisma-types';
import type {
  DraftRevisionState,
  DraftRevisionStateRow,
  DraftRevisionStateTable,
  DraftRevisionWriteStateCommandData,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import {
  createDraftRevisionTestingModule,
  prepareDraftRevisionTest,
} from './utils';

export interface SeedRow {
  id?: string;
  createdId?: string;
  versionId?: string;
  readonly?: boolean;
  createdAt?: Date;
  publishedAt?: Date;
  data?: JsonValue;
  meta?: JsonValue;
  hash?: string;
  schemaHash?: string;
  fileBlobIds?: string[];
}

export interface SeedTable {
  id?: string;
  createdId?: string;
  versionId?: string;
  readonly?: boolean;
  createdAt?: Date;
  system?: boolean;
  rows?: SeedRow[];
}

export function row(
  overrides: Partial<DraftRevisionStateRow> = {},
): DraftRevisionStateRow {
  const createdAt = new Date('2025-01-01T00:00:00.000Z');
  return {
    id: 'product-1',
    createdId: nanoid(),
    versionId: nanoid(),
    readonly: false,
    createdAt,
    updatedAt: createdAt,
    publishedAt: new Date('2025-02-01T00:00:00.000Z'),
    data: { title: 'Original' },
    meta: {},
    hash: 'data-hash',
    schemaHash: 'schema-hash',
    fileBlobs: [],
    ...overrides,
  };
}

export function table(
  overrides: Partial<DraftRevisionStateTable> = {},
): DraftRevisionStateTable {
  const createdAt = new Date('2025-01-01T00:00:00.000Z');
  return {
    id: 'products',
    createdId: nanoid(),
    versionId: nanoid(),
    readonly: false,
    createdAt,
    updatedAt: createdAt,
    system: false,
    rows: [],
    ...overrides,
  };
}

export async function createFileBlob(prisma: PrismaService): Promise<string> {
  const id = nanoid();
  await prisma.fileBlob.create({
    data: {
      id,
      projectId: `project-${id}`,
      hash: `hash-${id}`,
      size: BigInt(1),
    },
  });
  return id;
}

export async function failDeletingRowWithCreatedId(
  prisma: PrismaService,
  createdId: string,
): Promise<() => Promise<void>> {
  const suffix = nanoid()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
  const functionName = `fail_detached_row_delete_${suffix}`;
  const triggerName = `fail_detached_row_delete_${suffix}`;
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."createdId" = '${createdId}' THEN RAISE EXCEPTION 'simulated detached row cleanup failure'; END IF; RETURN OLD; END; $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER "${triggerName}" BEFORE DELETE ON "Row" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`,
  );
  return async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON "Row"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${functionName}"()`,
    );
  };
}

export async function seedTable(
  prisma: PrismaService,
  revisionId: string,
  input: SeedTable = {},
): Promise<{ versionId: string; rows: { versionId: string }[] }> {
  const table = {
    id: input.id ?? 'products',
    createdId: input.createdId ?? nanoid(),
    versionId: input.versionId ? `${input.versionId}-${nanoid()}` : nanoid(),
    readonly: input.readonly ?? false,
    createdAt: input.createdAt ?? new Date('2025-01-01T00:00:00.000Z'),
    system: input.system ?? false,
  };
  const rows = [];

  for (const inputRow of input.rows ?? []) {
    const row = {
      id: inputRow.id ?? 'product-1',
      createdId: inputRow.createdId ?? nanoid(),
      versionId: inputRow.versionId
        ? `${inputRow.versionId}-${nanoid()}`
        : nanoid(),
      readonly: inputRow.readonly ?? false,
      createdAt: inputRow.createdAt ?? table.createdAt,
      publishedAt: inputRow.publishedAt ?? new Date('2025-02-01T00:00:00.000Z'),
      data: inputRow.data === undefined ? { title: 'Original' } : inputRow.data,
      meta: inputRow.meta === undefined ? {} : inputRow.meta,
      hash: inputRow.hash ?? 'data-hash',
      schemaHash: inputRow.schemaHash ?? 'schema-hash',
      fileBlobIds: inputRow.fileBlobIds ?? [],
    };
    const { fileBlobIds, ...rowData } = row;

    await prisma.row.create({
      data: {
        ...rowData,
        readonly: row.readonly,
        data: row.data === null ? Prisma.JsonNull : (row.data as object),
        meta: row.meta === null ? Prisma.JsonNull : (row.meta as object),
        fileBlobs: { connect: fileBlobIds.map((id) => ({ id })) },
      },
    });
    rows.push(row);
  }

  await prisma.table.create({
    data: {
      ...table,
      rows: { connect: rows.map(({ versionId }) => ({ versionId })) },
      revisions: { connect: { id: revisionId } },
    },
  });

  return {
    versionId: table.versionId,
    rows: rows.map(({ versionId }) => ({ versionId })),
  };
}

export async function seedEquivalentHeadAndDraft(
  prisma: PrismaService,
  headRevisionId: string,
  draftRevisionId: string,
): Promise<{ head: DraftRevisionState; draft: DraftRevisionState }> {
  await seedTable(prisma, headRevisionId, {
    id: 'products',
    createdId: 'table-created',
    versionId: 'head-table-version',
    readonly: true,
    rows: [
      {
        id: 'product-1',
        createdId: 'row-created',
        versionId: 'head-row-version',
        readonly: true,
        data: { title: 'Same' },
      },
    ],
  });
  await seedTable(prisma, draftRevisionId, {
    id: 'products',
    createdId: 'table-created',
    versionId: 'draft-table-version',
    rows: [
      {
        id: 'product-1',
        createdId: 'row-created',
        versionId: 'draft-row-version',
        data: { title: 'Same' },
      },
    ],
  });
  return {
    head: await readState(prisma, headRevisionId),
    draft: await readState(prisma, draftRevisionId),
  };
}

export async function readState(
  prisma: PrismaService,
  revisionId: string,
): Promise<DraftRevisionState> {
  const tables = await prisma.revision
    .findUniqueOrThrow({ where: { id: revisionId } })
    .tables({
      orderBy: { versionId: 'asc' },
      include: {
        rows: {
          orderBy: { versionId: 'asc' },
          include: {
            fileBlobs: { select: { id: true }, orderBy: { id: 'asc' } },
          },
        },
      },
    });
  return { tables };
}

export function candidateFrom(state: DraftRevisionState): DraftRevisionState {
  return structuredClone(state);
}

export function requireTable(
  state: DraftRevisionState,
  index = 0,
): DraftRevisionState['tables'][number] {
  const table = state.tables[index];
  if (!table) {
    throw new Error(`Missing table at index ${index}`);
  }
  return table;
}

export function requireRow(
  table: DraftRevisionState['tables'][number],
  index = 0,
): DraftRevisionState['tables'][number]['rows'][number] {
  const row = table.rows[index];
  if (!row) {
    throw new Error(`Missing row at index ${index}`);
  }
  return row;
}

export async function createDraftRevisionStateWriterTestKit() {
  const testKit = await createDraftRevisionTestingModule();
  const draftRevisionApi = testKit.draftRevisionApiService;
  const transactionService = testKit.transactionService;

  return {
    prismaService: testKit.prismaService,
    draftRevisionApi,
    transactionService,
    prepare() {
      return prepareDraftRevisionTest(testKit.prismaService);
    },
    seedTable(revisionId: string, input: SeedTable = {}) {
      return seedTable(testKit.prismaService, revisionId, input);
    },
    async seedState(revisionId: string, ...tables: DraftRevisionStateTable[]) {
      for (const candidate of tables) {
        await seedTable(testKit.prismaService, revisionId, {
          ...candidate,
          rows: candidate.rows.map(({ fileBlobs, ...candidateRow }) => ({
            ...candidateRow,
            fileBlobIds: fileBlobs.map(({ id }) => id),
          })),
        });
      }
    },
    readState(revisionId: string) {
      return readState(testKit.prismaService, revisionId);
    },
    createBlob() {
      return createFileBlob(testKit.prismaService);
    },
    seedEquivalentHeadAndDraft(
      headRevisionId: string,
      draftRevisionId: string,
    ) {
      return seedEquivalentHeadAndDraft(
        testKit.prismaService,
        headRevisionId,
        draftRevisionId,
      );
    },
    rowExists(versionId: string) {
      return testKit.prismaService.row
        .count({ where: { versionId } })
        .then(Boolean);
    },
    tableExists(versionId: string) {
      return testKit.prismaService.table
        .count({ where: { versionId } })
        .then(Boolean);
    },
    blobExists(id: string) {
      return testKit.prismaService.fileBlob
        .count({ where: { id } })
        .then(Boolean);
    },
    rowVersions(createdId: string) {
      return testKit.prismaService.row
        .findMany({ where: { createdId }, select: { versionId: true } })
        .then((rows) => rows.map(({ versionId }) => versionId).sort());
    },
    createdRows(createdIds: string[]) {
      return testKit.prismaService.row.count({
        where: { createdId: { in: createdIds } },
      });
    },
    createdTableCount(createdId: string) {
      return testKit.prismaService.table.count({ where: { createdId } });
    },
    writeState(data: DraftRevisionWriteStateCommandData) {
      return transactionService.run(() => draftRevisionApi.writeState(data));
    },
    cleanupDetachedState(states: DraftRevisionState[]) {
      return transactionService.run(() =>
        draftRevisionApi.cleanupDetachedState({ states }),
      );
    },
    close() {
      return testKit.module.close();
    },
  };
}

export async function givenStateWriter(
  kit: Awaited<ReturnType<typeof createDraftRevisionStateWriterTestKit>>,
  setup: {
    head?: DraftRevisionStateTable[];
    draft?: DraftRevisionStateTable[];
  } = {},
) {
  const revisions = await prepareDraftRevisionTest(kit.prismaService);
  const seed = async (
    revisionId: string,
    tables: DraftRevisionStateTable[],
  ) => {
    for (const candidate of tables) {
      await seedTable(kit.prismaService, revisionId, {
        ...candidate,
        rows: candidate.rows.map(({ fileBlobs, ...candidateRow }) => ({
          ...candidateRow,
          fileBlobIds: fileBlobs.map(({ id }) => id),
        })),
      });
    }
  };
  await seed(revisions.headRevisionId, setup.head ?? []);
  await seed(revisions.draftRevisionId, setup.draft ?? []);
  const initialHead = await readState(
    kit.prismaService,
    revisions.headRevisionId,
  );
  const initialDraft = await readState(
    kit.prismaService,
    revisions.draftRevisionId,
  );

  return {
    ...revisions,
    initialHead,
    initialDraft,
    candidate: () => candidateFrom(initialDraft),
    row: (candidate: DraftRevisionState, tableIndex = 0, rowIndex = 0) =>
      requireRow(requireTable(candidate, tableIndex), rowIndex),
    table: (candidate: DraftRevisionState, index = 0) =>
      requireTable(candidate, index),
    blob: () => createFileBlob(kit.prismaService),
    seedHead: async (...tables: DraftRevisionStateTable[]) => {
      for (const candidate of tables) {
        await seedTable(kit.prismaService, revisions.headRevisionId, {
          ...candidate,
          rows: candidate.rows.map(({ fileBlobs, ...candidateRow }) => ({
            ...candidateRow,
            fileBlobIds: fileBlobs.map(({ id }) => id),
          })),
        });
      }
    },
    seedDraft: async (...tables: DraftRevisionStateTable[]) => {
      for (const candidate of tables) {
        await seedTable(kit.prismaService, revisions.draftRevisionId, {
          ...candidate,
          rows: candidate.rows.map(({ fileBlobs, ...candidateRow }) => ({
            ...candidateRow,
            fileBlobIds: fileBlobs.map(({ id }) => id),
          })),
        });
      }
    },
    headState: () => readState(kit.prismaService, revisions.headRevisionId),
    draftState: () => readState(kit.prismaService, revisions.draftRevisionId),
    attachHeadTablesToDraft: async () => {
      const head = await readState(kit.prismaService, revisions.headRevisionId);
      await kit.prismaService.revision.update({
        where: { id: revisions.draftRevisionId },
        data: {
          tables: {
            connect: head.tables.map(({ versionId }) => ({ versionId })),
          },
        },
      });
    },
    write: (
      candidate: DraftRevisionState,
      sources?: DraftRevisionWriteStateCommandData['sources'],
    ) =>
      kit.writeState({
        revisionId: revisions.draftRevisionId,
        candidate,
        sources: sources ?? { head: initialHead, others: [] },
      }),
    cleanup: (states: DraftRevisionState[]) => kit.cleanupDetachedState(states),
    writeAndCleanupAtomically: (
      candidate: DraftRevisionState,
      states: DraftRevisionState[],
      sources: DraftRevisionWriteStateCommandData['sources'],
    ) =>
      kit.transactionService.run(async () => {
        await kit.draftRevisionApi.writeState({
          revisionId: revisions.draftRevisionId,
          candidate,
          sources,
        });
        return kit.draftRevisionApi.cleanupDetachedState({ states });
      }),
    hasRow: async (versionId: string) =>
      (await kit.prismaService.row.count({ where: { versionId } })) > 0,
    hasTable: async (versionId: string) =>
      (await kit.prismaService.table.count({ where: { versionId } })) > 0,
    hasTableCreatedId: async (createdId: string) =>
      (await kit.prismaService.table.count({ where: { createdId } })) > 0,
    hasBlob: async (id: string) =>
      (await kit.prismaService.fileBlob.count({ where: { id } })) > 0,
    rowVersions: async (createdId: string) =>
      (
        await kit.prismaService.row.findMany({
          where: { createdId },
          select: { versionId: true },
        })
      )
        .map(({ versionId }) => versionId)
        .sort(),
    retainRowInTable: (tableVersionId: string, rowVersionId: string) =>
      kit.prismaService.table.update({
        where: { versionId: tableVersionId },
        data: { rows: { connect: { versionId: rowVersionId } } },
      }),
    cleanupAfterRowRelink: (
      states: DraftRevisionState[],
      tableVersionId: string,
      rowVersionId: string,
    ) =>
      kit.transactionService.run(async () => {
        const tx = kit.transactionService.getTransaction();
        const originalDeleteMany = tx.row.deleteMany.bind(tx.row);
        const rowDelegate = tx.row as unknown as {
          deleteMany: (
            args: Parameters<typeof tx.row.deleteMany>[0],
          ) => Promise<unknown>;
        };
        rowDelegate.deleteMany = async (args) => {
          await tx.table.update({
            where: { versionId: tableVersionId },
            data: { rows: { connect: { versionId: rowVersionId } } },
          });
          return originalDeleteMany(args);
        };
        try {
          return await kit.draftRevisionApi.cleanupDetachedState({ states });
        } finally {
          rowDelegate.deleteMany =
            originalDeleteMany as typeof rowDelegate.deleteMany;
        }
      }),
    writeAfterCreatedRowDisappears: (
      revisionId: string,
      candidate: DraftRevisionState,
      sources: DraftRevisionWriteStateCommandData['sources'],
    ) =>
      kit.transactionService.run(async () => {
        const tx = kit.transactionService.getTransaction();
        const originalCreate = tx.row.create.bind(tx.row);
        const rowDelegate = tx.row as unknown as {
          create: (
            args: Parameters<typeof tx.row.create>[0],
          ) => Promise<{ versionId: string }>;
        };
        rowDelegate.create = async (args) => {
          const created = await originalCreate(args);
          await tx.row.delete({ where: { versionId: created.versionId } });
          return created;
        };
        try {
          return await kit.draftRevisionApi.writeState({
            revisionId,
            candidate,
            sources,
          });
        } finally {
          rowDelegate.create =
            originalCreate as unknown as typeof rowDelegate.create;
        }
      }),
    cleanupFailingOnRow: async <T>(
      createdId: string,
      operation: () => Promise<T>,
    ) => {
      const removeTrigger = await failDeletingRowWithCreatedId(
        kit.prismaService,
        createdId,
      );
      try {
        return await operation();
      } finally {
        await removeTrigger();
      }
    },
  };
}
