import type { JsonSchema, JsonValue } from '@revisium/schema-toolkit/types';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';

export interface SchemaEffectRef {
  historyIndex: number;
  patchIndex: number;
}

export interface DiscardedDataField {
  rowCreatedId: string;
  path: string;
}

export interface SchemaForeignKeyRetarget {
  targetTableCreatedId: string;
  fromTableId: string;
  toTableId: string;
}

export interface SchemaForeignKeyChange {
  role: 'head' | 'draft';
  targetTableCreatedId: string;
  path: string;
  before: string;
  after: string;
}

export interface ProjectDraftChangesSchemaQueryData {
  snapshot: DraftChangesSnapshot;
  tableCreatedId: string;
  operation: 'commit' | 'discard';
  effects: SchemaEffectRef[];
  discardedDataFields?: DiscardedDataField[];
  schemaRefs?: Record<string, JsonSchema>;
  foreignKeyRetargets?: SchemaForeignKeyRetarget[];
}

export interface SchemaProjectionRow {
  createdId: string;
  data: JsonValue;
}

export interface SchemaProjectionState {
  schema: JsonSchema;
  history: HistoryPatches[];
  rows: SchemaProjectionRow[];
}

export type SchemaProjectionBlockerCode =
  | 'INVALID_EFFECT_REFERENCE'
  | 'TABLE_COUNTERPART_MISSING'
  | 'SCHEMA_IDENTITY_MISSING'
  | 'SCHEMA_IDENTITY_AMBIGUOUS'
  | 'SCHEMA_HISTORY_MISSING'
  | 'SCHEMA_HISTORY_INVALID'
  | 'SCHEMA_HISTORY_PREFIX_MISMATCH'
  | 'SCHEMA_PROVENANCE_MISMATCH'
  | 'DEPENDENT_EFFECT_SPLIT'
  | 'UNREPRESENTABLE_REMAINDER';

export interface SchemaProjectionBlocker {
  code: SchemaProjectionBlockerCode;
  message: string;
  rowCreatedId?: string;
  path?: string;
  requiredDataFields?: DiscardedDataField[];
}

export type ProjectDraftChangesSchemaResult =
  | {
      status: 'projected';
      tableCreatedId: string;
      sourceFingerprint: string;
      head: SchemaProjectionState;
      draft: SchemaProjectionState;
      retainedHead: SchemaProjectionState;
      migratedHead: SchemaProjectionState;
      rowFieldMappings: Array<{ fromPath: string; toPath: string }>;
      rowTargetFieldMappings: Array<{ fromPath: string; toPath: string }>;
      selectedEffects: SchemaEffectRef[];
      foreignKeyChanges?: SchemaForeignKeyChange[];
    }
  | {
      status: 'blocked';
      blockers: SchemaProjectionBlocker[];
    };

export class ProjectDraftChangesSchemaQuery {
  constructor(public readonly data: ProjectDraftChangesSchemaQueryData) {}
}
