import { nanoid } from 'nanoid';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';
import type {
  Prisma,
  Table,
  Revision,
  Row,
  Branch,
} from 'src/__generated__/client';
import { SystemTables } from 'src/features/share/system-tables.consts';

const TWO_REVISIONS = 2;
const THREE_REVISIONS = 3;
const DEFAULT_SCENARIO_COUNT = 5;

export async function createBranch(
  prismaService: PrismaService,
): Promise<Branch> {
  return prismaService.branch.create({
    data: {
      id: nanoid(),
      name: nanoid(),
      projectId: nanoid(),
    },
  });
}

export async function createRevision(
  prismaService: PrismaService,
  branchId: string,
  parentId?: string,
): Promise<Revision> {
  return prismaService.revision.create({
    data: {
      id: nanoid(),
      branchId,
      ...(parentId ? { parentId } : {}),
    },
  });
}

export async function createRevisionPair(prismaService: PrismaService) {
  const branch = await createBranch(prismaService);
  const fromRevision = await createRevision(prismaService, branch.id);
  const toRevision = await createRevision(
    prismaService,
    branch.id,
    fromRevision.id,
  );

  return { branch, fromRevision, toRevision };
}

export async function createRevisionTriple(prismaService: PrismaService) {
  const branch = await createBranch(prismaService);
  const revision1 = await createRevision(prismaService, branch.id);
  const revision2 = await createRevision(
    prismaService,
    branch.id,
    revision1.id,
  );
  const revision3 = await createRevision(
    prismaService,
    branch.id,
    revision2.id,
  );

  return { branch, revision1, revision2, revision3 };
}

export async function createMultipleRevisions(prismaService: PrismaService) {
  return createRevisionTriple(prismaService);
}

export async function createTableVersion({
  prismaService,
  revisionId,
  id = nanoid(),
  createdId = nanoid(),
  system = false,
  readonly = false,
}: {
  prismaService: PrismaService;
  revisionId: string;
  id?: string;
  createdId?: string;
  system?: boolean;
  readonly?: boolean;
}): Promise<Table> {
  return prismaService.table.create({
    data: {
      id,
      createdId,
      versionId: nanoid(),
      system,
      readonly,
      revisions: {
        connect: { id: revisionId },
      },
    },
  });
}

export async function createRowVersion({
  prismaService,
  tableVersionId,
  id = nanoid(),
  createdId = nanoid(),
  publishedAt,
  data = { name: 'test' },
  hash = nanoid(),
  schemaHash = nanoid(),
}: {
  prismaService: PrismaService;
  tableVersionId: string;
  id?: string;
  createdId?: string;
  publishedAt?: Date;
  data?: Prisma.InputJsonValue;
  hash?: string;
  schemaHash?: string;
}): Promise<Row> {
  return prismaService.row.create({
    data: {
      id,
      createdId,
      versionId: nanoid(),
      ...(publishedAt ? { publishedAt } : {}),
      tables: {
        connect: { versionId: tableVersionId },
      },
      data,
      hash,
      schemaHash,
    },
  });
}

export async function createRevisionWithoutParent(
  prismaService: PrismaService,
) {
  const branch = await createBranch(prismaService);
  const revision = await createRevision(prismaService, branch.id);

  return { branch, revision };
}

export async function createRevisionChain(
  prismaService: PrismaService,
  length: number,
) {
  const branch = await createBranch(prismaService);
  const revisions: Revision[] = [];

  for (let index = 0; index < length; index += 1) {
    const parentId = revisions[index - 1]?.id;
    revisions.push(await createRevision(prismaService, branch.id, parentId));
  }

  return { branch, revisions };
}

function expectRevisionPair(revisions: Revision[]) {
  const fromRevision = revisions[0];
  const toRevision = revisions[1];

  if (!fromRevision || !toRevision) {
    throw new Error('Expected two revisions');
  }

  return { fromRevision, toRevision };
}

function expectRevisionTriple(revisions: Revision[]) {
  const revision1 = revisions[0];
  const revision2 = revisions[1];
  const revision3 = revisions[2];

  if (!revision1 || !revision2 || !revision3) {
    throw new Error('Expected three revisions');
  }

  return { revision1, revision2, revision3 };
}

export async function createTableChangesScenario(prismaService: PrismaService) {
  const { revisions } = await createRevisionChain(prismaService, TWO_REVISIONS);
  const { fromRevision, toRevision } = expectRevisionPair(revisions);

  const addedTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
  });

  const fromTable = await createTableVersion({
    prismaService,
    revisionId: fromRevision.id,
  });

  const modifiedTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    id: fromTable.id,
    createdId: fromTable.createdId,
  });

  return { fromRevision, toRevision, addedTable, fromTable, modifiedTable };
}

export async function createMultipleTableChangesScenario(
  prismaService: PrismaService,
  count = DEFAULT_SCENARIO_COUNT,
) {
  const { revisions } = await createRevisionChain(prismaService, TWO_REVISIONS);
  const { fromRevision, toRevision } = expectRevisionPair(revisions);

  for (let index = 0; index < count; index += 1) {
    await createTableVersion({
      prismaService,
      revisionId: toRevision.id,
    });
  }

  return { fromRevision, toRevision };
}

export async function createTablesWithSystemScenario(
  prismaService: PrismaService,
) {
  const { revisions } = await createRevisionChain(prismaService, TWO_REVISIONS);
  const { fromRevision, toRevision } = expectRevisionPair(revisions);

  const systemTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    system: true,
  });

  const regularTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    system: false,
  });

  return { fromRevision, toRevision, systemTable, regularTable };
}

export async function createRenamedTableScenario(prismaService: PrismaService) {
  const { revisions } = await createRevisionChain(prismaService, TWO_REVISIONS);
  const { fromRevision, toRevision } = expectRevisionPair(revisions);

  const fromTable = await createTableVersion({
    prismaService,
    revisionId: fromRevision.id,
  });

  const toTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    createdId: fromTable.createdId,
  });

  return { fromRevision, toRevision, fromTable, toTable };
}

export async function createTableWithRowsScenario(
  prismaService: PrismaService,
) {
  const { revisions } = await createRevisionChain(prismaService, TWO_REVISIONS);
  const { fromRevision, toRevision } = expectRevisionPair(revisions);

  const table = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
  });

  await createRowVersion({
    prismaService,
    tableVersionId: table.versionId,
  });

  return { fromRevision, toRevision, table };
}

export async function createTableWithMigrationScenario(
  prismaService: PrismaService,
) {
  const { revisions } = await createRevisionChain(prismaService, TWO_REVISIONS);
  const { fromRevision, toRevision } = expectRevisionPair(revisions);

  const fromMigrationTable = await createTableVersion({
    prismaService,
    revisionId: fromRevision.id,
    id: SystemTables.Migration,
    system: true,
    readonly: true,
  });

  const toMigrationTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    id: SystemTables.Migration,
    createdId: fromMigrationTable.createdId,
    system: true,
    readonly: true,
  });

  const addedTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
  });

  const migrationData = {
    id: nanoid(),
    tableId: addedTable.id,
    changeType: 'init',
  };

  await createRowVersion({
    prismaService,
    tableVersionId: toMigrationTable.versionId,
    publishedAt: new Date(),
    data: migrationData,
  });

  return { fromRevision, toRevision, addedTable, migrationData };
}

export async function createTableWithViewsScenario(
  prismaService: PrismaService,
) {
  const { revisions } = await createRevisionChain(prismaService, TWO_REVISIONS);
  const { fromRevision, toRevision } = expectRevisionPair(revisions);

  const addedTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
  });

  const viewsTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    id: SystemTables.Views,
    system: true,
  });

  await createRowVersion({
    prismaService,
    tableVersionId: viewsTable.versionId,
    id: addedTable.id,
    data: {
      version: 1,
      defaultViewId: 'default',
      views: [
        { id: 'default', name: 'Default', columns: null },
        { id: 'custom', name: 'Custom View', columns: [{ field: 'id' }] },
      ],
    },
  });

  return { fromRevision, toRevision, addedTable };
}

export async function createTableWithModifiedViewsScenario(
  prismaService: PrismaService,
) {
  const { revisions } = await createRevisionChain(prismaService, TWO_REVISIONS);
  const { fromRevision, toRevision } = expectRevisionPair(revisions);

  const tableCreatedId = nanoid();
  const tableId = nanoid();

  const fromTable = await createTableVersion({
    prismaService,
    revisionId: fromRevision.id,
    id: tableId,
    createdId: tableCreatedId,
  });

  const modifiedTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    id: tableId,
    createdId: tableCreatedId,
  });

  const fromViewsTable = await createTableVersion({
    prismaService,
    revisionId: fromRevision.id,
    id: SystemTables.Views,
    system: true,
  });

  await createRowVersion({
    prismaService,
    tableVersionId: fromViewsTable.versionId,
    id: tableId,
    data: {
      version: 1,
      defaultViewId: 'default',
      views: [{ id: 'default', name: 'Default', columns: null }],
    },
  });

  const toViewsTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    id: SystemTables.Views,
    createdId: fromViewsTable.createdId,
    system: true,
  });

  await createRowVersion({
    prismaService,
    tableVersionId: toViewsTable.versionId,
    id: tableId,
    data: {
      version: 1,
      defaultViewId: 'default',
      views: [
        {
          id: 'default',
          name: 'Default',
          columns: [{ field: 'id', width: 200 }],
        },
      ],
    },
  });

  return { fromRevision, toRevision, fromTable, modifiedTable };
}

export async function createTableWithRemovedViewsScenario(
  prismaService: PrismaService,
) {
  const { revisions } = await createRevisionChain(prismaService, TWO_REVISIONS);
  const { fromRevision, toRevision } = expectRevisionPair(revisions);

  const tableCreatedId = nanoid();
  const tableId = nanoid();

  const fromTable = await createTableVersion({
    prismaService,
    revisionId: fromRevision.id,
    id: tableId,
    createdId: tableCreatedId,
  });

  const modifiedTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    id: tableId,
    createdId: tableCreatedId,
  });

  const fromViewsTable = await createTableVersion({
    prismaService,
    revisionId: fromRevision.id,
    id: SystemTables.Views,
    system: true,
  });

  await createRowVersion({
    prismaService,
    tableVersionId: fromViewsTable.versionId,
    id: tableId,
    data: {
      version: 1,
      defaultViewId: 'default',
      views: [
        { id: 'default', name: 'Default', columns: null },
        { id: 'custom', name: 'Custom', columns: [{ field: 'id' }] },
      ],
    },
  });

  const toViewsTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    id: SystemTables.Views,
    createdId: fromViewsTable.createdId,
    system: true,
  });

  await createRowVersion({
    prismaService,
    tableVersionId: toViewsTable.versionId,
    id: tableId,
    data: {
      version: 1,
      defaultViewId: 'default',
      views: [{ id: 'default', name: 'Default', columns: null }],
    },
  });

  return { fromRevision, toRevision, fromTable, modifiedTable };
}

export async function createRowChangesScenario(prismaService: PrismaService) {
  const { revisions } = await createRevisionChain(prismaService, TWO_REVISIONS);
  const { fromRevision, toRevision } = expectRevisionPair(revisions);

  const fromTable = await createTableVersion({
    prismaService,
    revisionId: fromRevision.id,
  });

  const toTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    id: fromTable.id,
    createdId: fromTable.createdId,
  });

  const addedRow = await createRowVersion({
    prismaService,
    tableVersionId: toTable.versionId,
  });

  return {
    fromRevision,
    toRevision,
    fromTable,
    toTable,
    table: toTable,
    addedRow,
  };
}

export async function createMultipleTableRowChangesScenario(
  prismaService: PrismaService,
) {
  const { revisions } = await createRevisionChain(prismaService, TWO_REVISIONS);
  const { fromRevision, toRevision } = expectRevisionPair(revisions);

  const fromTable1 = await createTableVersion({
    prismaService,
    revisionId: fromRevision.id,
  });

  const toTable1 = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    id: fromTable1.id,
    createdId: fromTable1.createdId,
  });

  const fromTable2 = await createTableVersion({
    prismaService,
    revisionId: fromRevision.id,
  });

  const toTable2 = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    id: fromTable2.id,
    createdId: fromTable2.createdId,
  });

  await createRowVersion({
    prismaService,
    tableVersionId: toTable1.versionId,
    data: { name: 'table1' },
  });

  await createRowVersion({
    prismaService,
    tableVersionId: toTable2.versionId,
    data: { name: 'table2' },
  });

  return { fromRevision, toRevision, table1: toTable1, table2: toTable2 };
}

export async function createRowsWithSearchScenario(
  prismaService: PrismaService,
) {
  const { fromRevision, toRevision, fromTable, toTable } =
    await createTablePairScenario(prismaService);

  const searchRow = await createRowVersion({
    prismaService,
    tableVersionId: toTable.versionId,
    id: `search-test-${nanoid()}`,
    data: { name: 'searchable' },
  });

  return {
    fromRevision,
    toRevision,
    fromTable,
    toTable,
    table: toTable,
    searchRow,
  };
}

export async function createMultipleRowChangesScenario(
  prismaService: PrismaService,
  count = DEFAULT_SCENARIO_COUNT,
) {
  const { fromRevision, toRevision, fromTable, toTable } =
    await createTablePairScenario(prismaService);

  for (let index = 0; index < count; index += 1) {
    await createRowVersion({
      prismaService,
      tableVersionId: toTable.versionId,
      data: { name: `row${index}` },
    });
  }

  return { fromRevision, toRevision, fromTable, toTable, table: toTable };
}

export async function createRowsInSystemTableScenario(
  prismaService: PrismaService,
) {
  const { revisions } = await createRevisionChain(prismaService, TWO_REVISIONS);
  const { fromRevision, toRevision } = expectRevisionPair(revisions);

  const fromSystemTable = await createTableVersion({
    prismaService,
    revisionId: fromRevision.id,
    system: true,
  });

  const toSystemTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    id: fromSystemTable.id,
    createdId: fromSystemTable.createdId,
    system: true,
  });

  const fromRegularTable = await createTableVersion({
    prismaService,
    revisionId: fromRevision.id,
    system: false,
  });

  const toRegularTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    id: fromRegularTable.id,
    createdId: fromRegularTable.createdId,
    system: false,
  });

  await createRowVersion({
    prismaService,
    tableVersionId: toSystemTable.versionId,
    data: { name: 'system' },
  });

  await createRowVersion({
    prismaService,
    tableVersionId: toRegularTable.versionId,
    data: { name: 'regular' },
  });

  return {
    fromRevision,
    toRevision,
    systemTable: toSystemTable,
    regularTable: toRegularTable,
  };
}

export async function createRenamedRowScenario(prismaService: PrismaService) {
  const { fromRevision, toRevision, fromTable, toTable } =
    await createTablePairScenario(prismaService);

  const sameHash = nanoid();
  const sameSchemaHash = nanoid();
  const sameData = { name: 'test' };

  const fromRow = await createRowVersion({
    prismaService,
    tableVersionId: fromTable.versionId,
    data: sameData,
    hash: sameHash,
    schemaHash: sameSchemaHash,
  });

  const toRow = await createRowVersion({
    prismaService,
    tableVersionId: toTable.versionId,
    createdId: fromRow.createdId,
    data: sameData,
    hash: sameHash,
    schemaHash: sameSchemaHash,
  });

  return { fromRevision, toRevision, fromTable, toTable, fromRow, toRow };
}

export async function createModifiedRowScenario(prismaService: PrismaService) {
  const { fromRevision, toRevision, fromTable, toTable } =
    await createTablePairScenario(prismaService);
  const rowCreatedId = nanoid();

  await createRowVersion({
    prismaService,
    tableVersionId: fromTable.versionId,
    createdId: rowCreatedId,
    data: { name: 'old value' },
  });

  await createRowVersion({
    prismaService,
    tableVersionId: toTable.versionId,
    createdId: rowCreatedId,
    data: { name: 'new value' },
  });

  return { fromRevision, toRevision, fromTable, toTable };
}

export async function createMultipleRevisionRowChangesScenario(
  prismaService: PrismaService,
) {
  const { revisions } = await createRevisionChain(
    prismaService,
    THREE_REVISIONS,
  );
  const { revision1, revision2, revision3 } = expectRevisionTriple(revisions);

  const table = await prismaService.table.create({
    data: {
      id: nanoid(),
      createdId: nanoid(),
      versionId: nanoid(),
      revisions: {
        connect: revisions.map(({ id }) => ({ id })),
      },
    },
  });

  await createRowVersion({
    prismaService,
    tableVersionId: table.versionId,
    data: { name: 'test' },
  });

  return { revision1, revision2, revision3, table };
}

async function createTablePairScenario(prismaService: PrismaService) {
  const { revisions } = await createRevisionChain(prismaService, TWO_REVISIONS);
  const { fromRevision, toRevision } = expectRevisionPair(revisions);

  const fromTable = await createTableVersion({
    prismaService,
    revisionId: fromRevision.id,
  });

  const toTable = await createTableVersion({
    prismaService,
    revisionId: toRevision.id,
    id: fromTable.id,
    createdId: fromTable.createdId,
  });

  return { fromRevision, toRevision, fromTable, toTable };
}
