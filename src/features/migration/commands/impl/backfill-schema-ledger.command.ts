export interface BackfillSchemaLedgerData {
  readonly projectId: string;
  readonly branchName: string;
  readonly dryRun?: boolean | null;
  readonly comment?: string | null;
}

export class BackfillSchemaLedgerCommand {
  constructor(public readonly data: BackfillSchemaLedgerData) {}
}

export const BACKFILL_STATUSES = ['notNeeded', 'planned', 'refused'] as const;

export type BackfillStatus = (typeof BACKFILL_STATUSES)[number];

export const BACKFILL_REFUSAL_CODES = [
  'draftStructureChanged',
  'schemaNotReproducible',
] as const;

export type BackfillRefusalCode = (typeof BACKFILL_REFUSAL_CODES)[number];

export interface BackfillEntry {
  readonly id: string;
  readonly changeType: 'init' | 'update';
  readonly tableId: string;
  readonly hash: string;
}

export interface BackfillRefusal {
  readonly code: BackfillRefusalCode;
  readonly tableIds: readonly string[];
  readonly message: string;
}

interface BackfilledBranch {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
}

export interface BackfillNotNeeded extends BackfilledBranch {
  readonly status: 'notNeeded';
}

export interface BackfillPlanned extends BackfilledBranch {
  readonly status: 'planned';
  readonly entries: readonly BackfillEntry[];
}

export interface BackfillRefused extends BackfilledBranch {
  readonly status: 'refused';
  readonly refusal: BackfillRefusal;
}

export type SchemaLedgerBackfill =
  | BackfillNotNeeded
  | BackfillPlanned
  | BackfillRefused;
