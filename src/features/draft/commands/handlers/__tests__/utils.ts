import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { CommandBus, CqrsModule, QueryBus } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import {
  getNumberSchema,
  getObjectSchema,
  getStringSchema,
  getRefSchema,
} from '@revisium/schema-toolkit/mocks';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  JsonObjectSchema,
  JsonSchemaTypeName,
} from '@revisium/schema-toolkit/types';
import { BranchModule } from 'src/features/branch/branch.module';
import { DraftRevisionModule } from 'src/features/draft-revision/draft-revision.module';
import { DraftModule } from 'src/features/draft/draft.module';
import { DraftApiService } from 'src/features/draft/draft-api.service';
import { DraftTransactionalCommands } from 'src/features/draft/draft.transactional.commands';
import { MigrationContextService } from 'src/features/draft/migration-context.service';
import { PluginModule } from 'src/features/plugin/plugin.module';
import { PluginService } from 'src/features/plugin/plugin.service';
import { RevisionModule } from 'src/features/revision/revision.module';
import { RowModule } from 'src/features/row/row.module';
import { MigrationModule } from 'src/features/migration/migration.module';
import { ShareModule } from 'src/features/share/share.module';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { ViewsMigrationService } from 'src/features/share/views-migration.service';
import { TableModule } from 'src/features/table/table.module';
import { ViewsModule } from 'src/features/views/views.module';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { StorageModule } from 'src/infrastructure/storage/storage.module';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export const testSchema: JsonObjectSchema = getObjectSchema({
  ver: getNumberSchema(),
});

export const testSchemaString: JsonObjectSchema = getObjectSchema({
  ver: getStringSchema(),
});

export const testSchemaWithRef: JsonObjectSchema = getObjectSchema({
  ver: getNumberSchema(),
  file: getRefSchema(SystemSchemaIds.File),
});

export const invalidTestSchema: JsonObjectSchema = {
  type: JsonSchemaTypeName.Object,
  required: ['123', '$ver'],
  properties: {
    '123': { type: JsonSchemaTypeName.String, default: '' },
    $ver: { type: JsonSchemaTypeName.Number, default: 0 },
  },
  additionalProperties: false,
};

export const getTestLinkedSchema = (
  foreignKeyTableId: string,
): JsonObjectSchema => ({
  type: JsonSchemaTypeName.Object,
  required: ['link'],
  properties: {
    link: {
      type: JsonSchemaTypeName.String,
      default: '',
      foreignKey: foreignKeyTableId,
    },
  },
  additionalProperties: false,
});

const mockStorage = {
  isAvailable: true,
  canServeFiles: false,
  uploadFile: jest.fn().mockResolvedValue({
    key: 'uploads/fake.png',
  }),
  getPublicUrl: jest.fn((key: string) => `http://test-files/${key}`),
};

export const createTestingModule = async () => {
  const module: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      DatabaseModule,
      CqrsModule,
      StorageModule.forRoot(),
      ShareModule,
      PluginModule,
      MigrationModule.forRoot(),
      RevisionModule,
      BranchModule,
      TableModule,
      RowModule,
      DraftRevisionModule,
      DraftModule,
      ViewsModule,
      CacheModule.register(),
    ],
  })
    .overrideProvider(STORAGE_SERVICE)
    .useValue(mockStorage)
    .compile();

  await module.init();

  const prismaService = module.get(PrismaService);
  const transactionService = module.get(TransactionPrismaService);
  const shareTransactionalQueries = module.get(ShareTransactionalQueries);
  const pluginService = module.get(PluginService);
  const queryBus = module.get(QueryBus);
  const commandBus = module.get(CommandBus);
  const draftApiService = module.get(DraftApiService);
  const draftTransactionalCommands = module.get(DraftTransactionalCommands);
  const migrationContextService = module.get(MigrationContextService);
  const viewsMigrationService = module.get(ViewsMigrationService);

  return {
    module,
    prismaService,
    transactionService,
    shareTransactionalQueries,
    pluginService,
    queryBus,
    commandBus,
    draftApiService,
    draftTransactionalCommands,
    migrationContextService,
    viewsMigrationService,
  };
};
