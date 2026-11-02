import {
  type PlannedTableRepair,
  type RenumberedMigration,
  REPAIR_OUTCOMES,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';

export interface RepairSchemaLedgerData {
  readonly projectId: string;
  readonly branchName: string;
  readonly tableIds?: readonly string[] | null;
  readonly dryRun?: boolean | null;
}

export class RepairSchemaLedgerCommand {
  constructor(public readonly data: RepairSchemaLedgerData) {}
}

export const TABLE_REPAIR_OUTCOMES = [...REPAIR_OUTCOMES, 'stale'] as const;

export type TableRepairOutcome = (typeof TABLE_REPAIR_OUTCOMES)[number];

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
