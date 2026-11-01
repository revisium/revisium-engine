import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DiffService } from 'src/features/share/diff.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import { ViewsMigrationService } from 'src/features/share/views-migration.service';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { SHARE_COMMANDS_HANDLERS } from 'src/features/share/commands/handlers';
import { SHARE_QUERIES_HANDLERS } from 'src/features/share/queries/handlers';
import { ForeignKeysService } from 'src/features/share/foreign-keys.service';
import { ShareCommands } from 'src/features/share/share.commands';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { SystemTablesService } from 'src/features/share/system-tables.service';

@Module({
  imports: [DatabaseModule, CqrsModule, CacheModule.register()],
  providers: [
    ShareTransactionalQueries,
    ShareCommands,
    ForeignKeysService,
    DiffService,
    JsonSchemaStoreService,
    JsonSchemaValidatorService,
    SystemTablesService,
    ViewsMigrationService,
    {
      provide: NativeSchemaRules,
      useFactory: (
        schemaStore: JsonSchemaStoreService,
        validator: JsonSchemaValidatorService,
      ) => new NativeSchemaRules(schemaStore.refs, validator),
      inject: [JsonSchemaStoreService, JsonSchemaValidatorService],
    },
    LedgerReplayer,
    ...SHARE_COMMANDS_HANDLERS,
    ...SHARE_QUERIES_HANDLERS,
  ],
  exports: [
    ShareTransactionalQueries,
    ShareCommands,
    ForeignKeysService,
    DiffService,
    JsonSchemaStoreService,
    JsonSchemaValidatorService,
    SystemTablesService,
    ViewsMigrationService,
    NativeSchemaRules,
    LedgerReplayer,
  ],
})
export class ShareModule {}
