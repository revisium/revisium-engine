import { REPAIR_OUTCOMES } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import type { ReplayFailure } from 'src/features/share/ledger-replay/ledger-replay';

export const ROW_DIAGNOSTICS = ['none', 'headAndDraft', 'all'] as const;

export type RowDiagnostics = (typeof ROW_DIAGNOSTICS)[number];

export interface ScanSchemaLedgerData {
  readonly projectId?: string | null;
  readonly branchName?: string | null;
  readonly cursor?: string | null;
  readonly limit?: number | null;
  readonly rowDiagnostics?: RowDiagnostics | null;
}

export class ScanSchemaLedgerQuery {
  constructor(public readonly data: ScanSchemaLedgerData) {}
}

export const FINDING_ROLES = ['head', 'draft', 'history'] as const;

export type FindingRole = (typeof FINDING_ROLES)[number];

export const UNLEDGERED_REASONS = [
  'noMigrationTable',
  'noLineage',
  'brokenLineage',
] as const;

export type UnledgeredReason = (typeof UNLEDGERED_REASONS)[number];

interface UnledgeredOf<Reason extends UnledgeredReason> {
  readonly reason: Reason;
}

export interface BrokenLineage extends UnledgeredOf<'brokenLineage'> {
  readonly migrationId: string;
}

export type UnledgeredDetail =
  | UnledgeredOf<'noMigrationTable' | 'noLineage'>
  | BrokenLineage;

export const DAMAGE_SHAPES = ['unpublished', 'published', 'unknown'] as const;

export type DamageShape = (typeof DAMAGE_SHAPES)[number];

export const DAMAGED_TABLE_REPAIRS = [...REPAIR_OUTCOMES, 'deferred'] as const;

export type DamagedTableRepair = (typeof DAMAGED_TABLE_REPAIRS)[number];

export interface DamagedTableDetail {
  readonly shape: DamageShape;
  readonly repair: DamagedTableRepair;
}

export const ROW_HASH_REASONS = [
  'unmigratedByAsync',
  'renamedReference',
  'unmigratedRows',
  'unknownHash',
] as const;

export type RowHashReason = (typeof ROW_HASH_REASONS)[number];

export interface MismatchedRowHash {
  readonly hash: string;
  readonly rowCount: number;
  readonly reason: RowHashReason;
}

export interface RowSchemaHashMismatchDetail {
  readonly schemaHash: string;
  readonly rowHashes: readonly MismatchedRowHash[];
}

export const FINDING_CODES = [
  'unledgeredTable',
  'unreplayableLedger',
  'damagedTable',
  'draftOnlyDamage',
  'damagedHistory',
  'rowSchemaHashMismatch',
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

interface FindingOf<Code extends FindingCode, Detail> {
  readonly code: Code;
  readonly detail: Detail;
}

export type FindingContent =
  | FindingOf<'unledgeredTable', UnledgeredDetail>
  | FindingOf<'unreplayableLedger', ReplayFailure>
  | FindingOf<'damagedTable', DamagedTableDetail>
  | FindingOf<'draftOnlyDamage' | 'damagedHistory', Record<string, never>>
  | FindingOf<'rowSchemaHashMismatch', RowSchemaHashMismatchDetail>;

export interface FindingSite {
  readonly projectId: string;
  readonly branchName: string;
  readonly tableId: string;
  readonly role: FindingRole;
}

// Every revision of the branch that shares the finding's evaluation.
export interface ListedRevisions {
  readonly revisionIds: readonly string[];
}

// The history revisions without a migration table, which no backfill rewrites, by their count and the earliest.
export interface CountedRevisions {
  readonly revisionCount: number;
  readonly firstRevisionId: string;
}

export type SchemaLedgerFinding = FindingContent &
  FindingSite &
  (ListedRevisions | CountedRevisions);

export interface SchemaLedgerScanStats {
  readonly branches: number;
  readonly revisions: number;
  readonly ledgerReplays: number;
  readonly schemaTableReads: number;
  readonly schemaChecks: number;
  readonly rowHashReads: number;
}

export interface SchemaLedgerScan {
  readonly findings: readonly SchemaLedgerFinding[];
  readonly nextCursor: string | null;
  readonly stats: SchemaLedgerScanStats;
}
