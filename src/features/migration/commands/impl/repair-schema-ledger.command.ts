import {
  type PlannedTableRepair,
  REPAIR_OUTCOMES,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import type { MigrationRenumbering } from 'src/features/share/ledger/native-migration-id';

export interface RepairSchemaLedgerData {
  readonly projectId: string;
  readonly branchName: string;
  readonly tableIds?: readonly string[] | null;
  readonly dryRun?: boolean | null;
}

export class RepairSchemaLedgerCommand {
  constructor(public readonly data: RepairSchemaLedgerData) {}
}

// A dry run reports `planned` where a written repair reports `repaired`.
export const TABLE_REPAIR_OUTCOMES = [
  ...REPAIR_OUTCOMES,
  'planned',
  'stale',
] as const;

export type TableRepairOutcome = (typeof TABLE_REPAIR_OUTCOMES)[number];

export interface TableRepair extends Omit<PlannedTableRepair, 'outcome'> {
  readonly outcome: TableRepairOutcome;
}

export interface SchemaLedgerRepair {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly dryRun: boolean;
  readonly tables: readonly TableRepair[];
  readonly renumberedMigrations: readonly MigrationRenumbering[];
}
