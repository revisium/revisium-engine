import type { RepairOutcome } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import type { ReplayFailure } from 'src/features/share/ledger-replay/ledger-replay';

export type RowDiagnostics = 'none' | 'headAndDraft' | 'all';

export interface ScanSchemaLedgerData {
  readonly projectId?: string;
  readonly branchName?: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly rowDiagnostics?: RowDiagnostics;
}

export class ScanSchemaLedgerQuery {
  constructor(public readonly data: ScanSchemaLedgerData) {}
}

export type FindingRole = 'head' | 'draft' | 'history';

export type UnledgeredDetail =
  | { readonly reason: 'noMigrationTable' | 'noLineage' }
  | { readonly reason: 'brokenLineage'; readonly migrationId: string };

export type DamageShape = 'unpublished' | 'published' | 'unknown';

export interface DamagedTableDetail {
  readonly shape: DamageShape;
  readonly repair: RepairOutcome | 'deferred';
}

export type RowHashReason =
  | 'unmigratedByAsync'
  | 'renamedReference'
  | 'unmigratedRows'
  | 'unknownHash';

export interface MismatchedRowHash {
  readonly hash: string;
  readonly rowCount: number;
  readonly reason: RowHashReason;
}

export interface RowSchemaHashMismatchDetail {
  readonly schemaHash: string;
  readonly rowHashes: readonly MismatchedRowHash[];
}

export type FindingContent =
  | { readonly code: 'unledgeredTable'; readonly detail: UnledgeredDetail }
  | { readonly code: 'unreplayableLedger'; readonly detail: ReplayFailure }
  | { readonly code: 'damagedTable'; readonly detail: DamagedTableDetail }
  | {
      readonly code: 'draftOnlyDamage' | 'damagedHistory';
      readonly detail: Record<string, never>;
    }
  | {
      readonly code: 'rowSchemaHashMismatch';
      readonly detail: RowSchemaHashMismatchDetail;
    };

export type SchemaLedgerFinding = FindingContent & {
  readonly projectId: string;
  readonly branchName: string;
  readonly tableId: string;
  readonly role: FindingRole;
  readonly revisionIds: readonly string[];
};

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
