import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { AbortMigrationCommand } from 'src/features/migration/commands/impl/abort-migration.command';
import {
  RepairSchemaLedgerCommand,
  type RepairSchemaLedgerData,
  type SchemaLedgerRepair,
} from 'src/features/migration/commands/impl/repair-schema-ledger.command';
import { GetMigrationStatusQuery } from 'src/features/migration/queries/impl/get-migration-status.query';
import { GetActiveMigrationsQuery } from 'src/features/migration/queries/impl/get-active-migrations.query';
import {
  type PlanSchemaLedgerRepairData,
  PlanSchemaLedgerRepairQuery,
  type SchemaLedgerRepairPlan,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import {
  type SchemaLedgerScan,
  type ScanSchemaLedgerData,
  ScanSchemaLedgerQuery,
} from 'src/features/migration/queries/impl/scan-schema-ledger.query';
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

  planSchemaLedgerRepair(
    data: PlanSchemaLedgerRepairData,
  ): Promise<SchemaLedgerRepairPlan> {
    return this.queryBus.execute(new PlanSchemaLedgerRepairQuery(data));
  }

  scanSchemaLedger(data: ScanSchemaLedgerData = {}): Promise<SchemaLedgerScan> {
    return this.queryBus.execute(new ScanSchemaLedgerQuery(data));
  }

  repairSchemaLedger(
    data: RepairSchemaLedgerData,
  ): Promise<SchemaLedgerRepair> {
    return this.commandBus.execute(new RepairSchemaLedgerCommand(data));
  }
}
