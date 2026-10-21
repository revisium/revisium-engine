import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';

export interface SourceHistoryInput {
  snapshot: DraftChangesSnapshot;
  schemaRefs?: Record<string, JsonSchema>;
}

export type SourceHistoryResult =
  | { status: 'traced'; history: SourceHistory }
  | { status: 'unrecorded' }
  | { status: 'blocked'; blocker: SourceHistoryBlocker };

export interface SourceHistory {
  pendingEvents: SourceEvent[];
  tables: SourceTable[];
}

export interface SourceEvent {
  migration: Migration;
  tableIdentity: string;
}

export interface SourceTable {
  identity: string;
  head?: { tableId: string; historyLength: number };
  draft?: { tableId: string; createdId: string };
  pendingGroups: SourceHistoryGroup[];
  taint?: SourceTableTaint;
}

export interface SourceHistoryGroup {
  historyIndex: number;
  origin: { kind: SourceGroupOriginKind; eventIndex: number };
  foreignKeys: SourceForeignKey[];
}

export type SourceGroupOriginKind = 'init' | 'update' | 'renameReference';

export interface SourceForeignKey {
  path: string;
  targetTableId: string;
  targetIdentity?: string;
}

export interface SourceTableTaint {
  code: SourceTableTaintCode;
  fromHistoryIndex: number;
  message: string;
}

export type SourceTableTaintCode =
  | 'SOURCE_EVENT_UNREPLAYABLE'
  | 'SOURCE_REFERENCE_INCONSISTENT'
  | 'SOURCE_HISTORY_MISMATCH'
  | 'SOURCE_SCHEMA_UNRECORDED_CHANGE';

export interface SourceHistoryBlocker {
  code: SourceHistoryBlockerCode;
  message: string;
  eventIndex?: number;
  tableIdentity?: string;
  tableId?: string;
}

export type SourceHistoryBlockerCode =
  | 'SOURCE_LEDGER_INVALID'
  | 'SOURCE_EVENT_INVALID'
  | 'SOURCE_TABLES_MISMATCH';
