import { CacheModule } from '@nestjs/cache-manager';
import { CqrsModule } from '@nestjs/cqrs';
import { Test, type TestingModule } from '@nestjs/testing';
import hash from 'object-hash';
import { nanoid } from 'nanoid';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { SHARE_QUERIES_HANDLERS } from 'src/features/share/queries/handlers';
import { tableViewsSchema } from 'src/features/share/schema/table-views-schema';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import { GetTableViewsHandler } from 'src/features/views/queries/handlers/get-table-views.handler';
import { Prisma } from 'src/__generated__/client';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

export interface ViewsQueryTestKit {
  prismaService: PrismaService;
  module: TestingModule;
  close(): Promise<void>;
}

export interface ViewsQueryScenario {
  headRevisionId: string;
  draftRevisionId: string;
  tableId: string;
}

export interface SharedViewsQueryScenario extends ViewsQueryScenario {
  viewsTableVersionId: string;
}

export interface SeparateViewsQueryScenario extends ViewsQueryScenario {
  headViewsTableVersionId: string;
  draftViewsTableVersionId: string;
}

export async function createViewsQueryTestKit(): Promise<ViewsQueryTestKit> {
  const module = await Test.createTestingModule({
    imports: [DatabaseModule, CqrsModule, CacheModule.register()],
    providers: [
      GetTableViewsHandler,
      ShareTransactionalQueries,
      ...SHARE_QUERIES_HANDLERS,
    ],
  }).compile();

  await module.init();

  return {
    module,
    prismaService: module.get(PrismaService),
    async close() {
      await module.close();
    },
  };
}

export async function givenViewsQueryTable(
  kit: ViewsQueryTestKit,
): Promise<ViewsQueryScenario> {
  const draft = await givenDraftProject(kit.prismaService);

  return {
    headRevisionId: draft.headRevisionId,
    draftRevisionId: draft.draftRevisionId,
    tableId: draft.tableId,
  };
}

export async function givenSharedViewsTable({
  kit,
  scenario,
}: {
  kit: ViewsQueryTestKit;
  scenario: ViewsQueryScenario;
}): Promise<SharedViewsQueryScenario> {
  const viewsTableVersionId = nanoid();
  const viewsTableCreatedId = nanoid();

  await kit.prismaService.table.create({
    data: {
      id: SystemTables.Views,
      versionId: viewsTableVersionId,
      createdId: viewsTableCreatedId,
      readonly: true,
      system: true,
      revisions: {
        connect: [
          { id: scenario.headRevisionId },
          { id: scenario.draftRevisionId },
        ],
      },
    },
  });

  return {
    ...scenario,
    viewsTableVersionId,
  };
}

export async function givenSeparateViewsTables({
  kit,
  scenario,
}: {
  kit: ViewsQueryTestKit;
  scenario: ViewsQueryScenario;
}): Promise<SeparateViewsQueryScenario> {
  const headViewsTableVersionId = nanoid();
  const draftViewsTableVersionId = nanoid();
  const viewsTableCreatedId = nanoid();

  await kit.prismaService.table.create({
    data: {
      id: SystemTables.Views,
      versionId: headViewsTableVersionId,
      createdId: viewsTableCreatedId,
      readonly: true,
      system: true,
      revisions: {
        connect: { id: scenario.headRevisionId },
      },
    },
  });

  await kit.prismaService.table.create({
    data: {
      id: SystemTables.Views,
      versionId: draftViewsTableVersionId,
      createdId: viewsTableCreatedId,
      readonly: true,
      system: true,
      revisions: {
        connect: { id: scenario.draftRevisionId },
      },
    },
  });

  return {
    ...scenario,
    headViewsTableVersionId,
    draftViewsTableVersionId,
  };
}

export async function createViewsRow({
  kit,
  viewsTableVersionId,
  tableId,
  data,
}: {
  kit: ViewsQueryTestKit;
  viewsTableVersionId: string;
  tableId: string;
  data: TableViewsData;
}): Promise<void> {
  const jsonData = JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;

  await kit.prismaService.row.create({
    data: {
      id: tableId,
      versionId: nanoid(),
      createdId: nanoid(),
      readonly: true,
      data: jsonData,
      hash: hash(data),
      schemaHash: hash(tableViewsSchema),
      tables: {
        connect: { versionId: viewsTableVersionId },
      },
    },
  });
}
