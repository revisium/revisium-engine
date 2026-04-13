import { GetMigrationStatusHandler } from 'src/features/migration/queries/handlers/get-migration-status.handler';
import { GetActiveMigrationsHandler } from 'src/features/migration/queries/handlers/get-active-migrations.handler';

export const MIGRATION_QUERY_HANDLERS = [
  GetMigrationStatusHandler,
  GetActiveMigrationsHandler,
];
