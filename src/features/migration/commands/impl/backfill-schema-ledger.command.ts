export interface BackfillSchemaLedgerData {
  readonly projectId: string;
  readonly branchName: string;
  readonly dryRun?: boolean | null;
  readonly comment?: string | null;
}

export class BackfillSchemaLedgerCommand {
  constructor(public readonly data: BackfillSchemaLedgerData) {}
}

export const BACKFILL_STATUSES = [
  'notNeeded',
  'planned',
  'backfilled',
  'refused',
] as const;

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

interface BackfillRevisions {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
}

export interface BackfillNotNeeded extends BackfillRevisions {
  readonly status: 'notNeeded';
}

export interface BackfillPlanned extends BackfillRevisions {
  readonly status: 'planned';
  readonly entries: readonly BackfillEntry[];
}

export interface BackfillCommitted extends BackfillRevisions {
  readonly status: 'backfilled';
  readonly previousHeadRevisionId: string;
  readonly entries: readonly BackfillEntry[];
}

export interface BackfillRefused extends BackfillRevisions {
  readonly status: 'refused';
  readonly refusal: BackfillRefusal;
}

export type SchemaLedgerBackfill =
  | BackfillNotNeeded
  | BackfillPlanned
  | BackfillCommitted
  | BackfillRefused;
