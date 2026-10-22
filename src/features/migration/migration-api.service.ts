import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { AbortMigrationCommand } from 'src/features/migration/commands/impl/abort-migration.command';
import { GetMigrationStatusQuery } from 'src/features/migration/queries/impl/get-migration-status.query';
import { GetActiveMigrationsQuery } from 'src/features/migration/queries/impl/get-active-migrations.query';
import {
  ActiveMigrationResult,
  MigrationStatusResult,
} from 'src/features/migration/types/migration.types';

@Injectable()
export class MigrationApiService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  getMigrationStatus(data: {
    revisionId: string;
    tableId: string;
  }): Promise<MigrationStatusResult | null> {
    return this.queryBus.execute(new GetMigrationStatusQuery(data));
  }

  getActiveMigrations(data: {
    revisionId: string;
  }): Promise<ActiveMigrationResult[]> {
    return this.queryBus.execute(new GetActiveMigrationsQuery(data));
  }

  abortMigration(data: { revisionId: string; tableId: string }): Promise<void> {
    return this.commandBus.execute(new AbortMigrationCommand(data));
  }
}
