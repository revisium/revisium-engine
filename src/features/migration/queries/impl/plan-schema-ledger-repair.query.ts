import type { JsonPatch } from '@revisium/schema-toolkit/types';

export interface PlanSchemaLedgerRepairData {
  readonly projectId: string;
  readonly branchName: string;
  readonly tableIds?: readonly string[];
}

export class PlanSchemaLedgerRepairQuery {
  constructor(public readonly data: PlanSchemaLedgerRepairData) {}
}

export const REPAIR_OUTCOMES = [
  'unledgered',
  'ledgerDoesNotReplay',
  'notDamaged',
  'draftOnlyDamage',
  'ledgerInconsistent',
  'alreadyRepaired',
  'repaired',
  'rowsNeedMigration',
  'patchNotReproducible',
  'blockedByDependency',
  'needsDraftStructureRevert',
] as const;

export type RepairOutcome = (typeof REPAIR_OUTCOMES)[number];

export interface InvalidRows {
  readonly count: number;
  readonly sampleRowIds: readonly string[];
}

export interface PlannedTableRepair {
  readonly tableId: string;
  readonly outcome: RepairOutcome;
  readonly migrationId?: string;
  readonly patches?: readonly JsonPatch[];
  readonly removedPaths?: readonly string[];
  readonly invalidRows?: InvalidRows;
  readonly blockedBy?: readonly string[];
}

export interface RenumberedMigration {
  readonly previousId: string;
  readonly id: string;
}

export interface ValidatedTableFingerprint {
  readonly tableVersionId: string;
  readonly rowCount: number;
  readonly digest: string;
}

export interface ConsultedTableFingerprint {
  readonly tableVersionId: string;
  readonly digest: string;
}

export interface ValidationFingerprint {
  readonly validatedTables: readonly ValidatedTableFingerprint[];
  readonly consultedTables: readonly ConsultedTableFingerprint[];
}

export interface SchemaLedgerRepairPlan {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly tables: readonly PlannedTableRepair[];
  readonly renumbered: readonly RenumberedMigration[];
  readonly fingerprint: ValidationFingerprint;
}
