import { StartAsyncMigrationHandler } from 'src/features/migration/commands/handlers/start-async-migration.handler';
import { AbortMigrationHandler } from 'src/features/migration/commands/handlers/abort-migration.handler';

export const MIGRATION_COMMAND_HANDLERS = [
  StartAsyncMigrationHandler,
  AbortMigrationHandler,
];
