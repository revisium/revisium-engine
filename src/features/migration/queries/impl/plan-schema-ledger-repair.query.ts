import type { JsonPatch } from '@revisium/schema-toolkit/types';
import type { MigrationRenumbering } from 'src/features/share/ledger/native-migration-id';

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
  readonly renumberedMigrations: readonly MigrationRenumbering[];
  readonly fingerprint: ValidationFingerprint;
}
