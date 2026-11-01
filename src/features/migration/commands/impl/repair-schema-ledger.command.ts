import type {
  PlannedTableRepair,
  RenumberedMigration,
  RepairOutcome,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';

export interface RepairSchemaLedgerData {
  readonly projectId: string;
  readonly branchName: string;
  readonly tableIds?: readonly string[];
  readonly dryRun?: boolean;
}

export class RepairSchemaLedgerCommand {
  constructor(public readonly data: RepairSchemaLedgerData) {}
}

export type TableRepairOutcome = RepairOutcome | 'stale';

export interface TableRepair extends Omit<PlannedTableRepair, 'outcome'> {
  readonly outcome: TableRepairOutcome;
}

export interface SchemaLedgerRepair {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly dryRun: boolean;
  readonly tables: readonly TableRepair[];
  readonly renumbered: readonly RenumberedMigration[];
}
