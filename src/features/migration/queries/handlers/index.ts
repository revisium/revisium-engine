import { GetMigrationStatusHandler } from 'src/features/migration/queries/handlers/get-migration-status.handler';
import { GetActiveMigrationsHandler } from 'src/features/migration/queries/handlers/get-active-migrations.handler';
import { ScanSchemaLedgerHandler } from 'src/features/migration/queries/handlers/scan-schema-ledger.handler';

export const MIGRATION_QUERY_HANDLERS = [
  GetMigrationStatusHandler,
  GetActiveMigrationsHandler,
  ScanSchemaLedgerHandler,
];
