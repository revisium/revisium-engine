import { Test, TestingModule } from '@nestjs/testing';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule, QueryBus } from '@nestjs/cqrs';
import { nanoid } from 'nanoid';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { ShareModule } from 'src/features/share/share.module';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { DraftModule } from 'src/features/draft/draft.module';
import { DraftApiService } from 'src/features/draft/draft-api.service';
import { SUB_SCHEMA_QUERIES_HANDLERS } from 'src/features/sub-schema/queries/handlers';
import { SubSchemaApiService } from 'src/features/sub-schema/sub-schema-api.service';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { StorageModule } from 'src/infrastructure/storage/storage.module';
import { TABLE_QUERIES_HANDLERS } from 'src/features/table/queries/handlers';
import { BRANCH_QUERIES_HANDLERS } from 'src/features/branch/quieries/handlers';
import { ViewsModule } from 'src/features/views/views.module';
import { RevisionModule } from 'src/features/revision/revision.module';
import { BranchModule } from 'src/features/branch/branch.module';
import { TableModule } from 'src/features/table/table.module';
import { RowModule } from 'src/features/row/row.module';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';

export interface PrepareSubSchemaTestResult {
  projectId: string;
  branchId: string;
  headRevisionId: string;
  draftRevisionId: string;
}

export async function prepareSubSchemaTest(
  prismaService: PrismaService,
): Promise<PrepareSubSchemaTestResult> {
  const projectId = nanoid();
  const branchId = nanoid();
  const headRevisionId = nanoid();
  const draftRevisionId = nanoid();

  await prismaService.branch.create({
    data: {
      id: branchId,
      name: `branch-${branchId}`,
      isRoot: true,
      projectId,
      revisions: {
        create: [
          {
            id: headRevisionId,
            isStart: true,
            isHead: true,
            hasChanges: false,
          },
          {
            id: draftRevisionId,
            parentId: headRevisionId,
            hasChanges: false,
            isDraft: true,
          },
        ],
      },
    },
  });

  const schemaTableVersionId = nanoid();
  const migrationTableVersionId = nanoid();

  await prismaService.table.create({
    data: {
      id: SystemTables.Schema,
      versionId: schemaTableVersionId,
      createdId: nanoid(),
      readonly: true,
      system: true,
      revisions: {
        connect: [{ id: headRevisionId }, { id: draftRevisionId }],
      },
    },
  });

  await prismaService.table.create({
    data: {
      id: SystemTables.Migration,
      versionId: migrationTableVersionId,
      createdId: nanoid(),
      readonly: true,
      system: true,
      revisions: {
        connect: [{ id: headRevisionId }, { id: draftRevisionId }],
      },
    },
  });

  return {
    projectId,
    branchId,
    headRevisionId,
    draftRevisionId,
  };
}

export const createSubSchemaTestingModule = async () => {
  const mockStorage = {
    isAvailable: true,
    canServeFiles: false,
    uploadFile: jest.fn().mockResolvedValue({
      key: 'uploads/fake.png',
    }),
    getPublicUrl: jest.fn((key: string) => `http://test-files/${key}`),
  };

  const module: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      DatabaseModule,
      CqrsModule,
      CacheModule.register(),
      ShareModule,
      PluginModule,
      StorageModule,
      RevisionModule,
      BranchModule,
      TableModule,
      RowModule,
      DraftRevisionModule,
      DraftModule,
      ViewsModule,
    ],
    providers: [
      SubSchemaApiService,
      ...SUB_SCHEMA_QUERIES_HANDLERS,
      ...TABLE_QUERIES_HANDLERS,
      ...BRANCH_QUERIES_HANDLERS,
    ],
  })
    .overrideProvider(STORAGE_SERVICE)
    .useValue(mockStorage)
    .compile();

  await module.init();

  return {
    module,
    prismaService: module.get(PrismaService),
    queryBus: module.get(QueryBus),
    transactionService: module.get(TransactionPrismaService),
    subSchemaApiService: module.get(SubSchemaApiService),
    draftApiService: module.get(DraftApiService),
  };
};
