import type { JsonValue } from '@revisium/schema-toolkit/types';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type {
  ProjectDraftChangesSchemaResult,
  SchemaEffectRef,
} from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';

export interface DraftChangeRef {
  readonly value: string;
}

export type DraftChangesCatalogueEntryKind =
  | 'table'
  | 'row'
  | 'rowField'
  | 'schemaField'
  | 'view'
  | 'viewConfiguration';

export type DraftChangesCatalogueClassification =
  | 'created'
  | 'deleted'
  | 'renamed'
  | 'updated'
  | 'computed'
  | 'atomic';

export type DraftChangesCatalogueTarget =
  | { kind: 'table'; tableCreatedId: string; tableId: string }
  | {
      kind: 'row';
      tableCreatedId: string;
      rowCreatedId: string;
      tableId: string;
      rowId: string;
    }
  | {
      kind: 'rowField';
      tableCreatedId: string;
      rowCreatedId: string;
      tableId: string;
      rowId: string;
      path: string;
    }
  | {
      kind: 'schemaField';
      tableCreatedId: string;
      tableId: string;
      path: string;
    }
  | {
      kind: 'view';
      tableCreatedId: string;
      tableId: string;
      viewId: string;
      component:
        | 'lifecycle'
        | 'name'
        | 'description'
        | 'search'
        | 'columns'
        | 'sorts'
        | 'filters';
    }
  | {
      kind: 'viewConfiguration';
      tableCreatedId: string;
      tableId: string;
      component: 'version' | 'defaultViewId' | 'order';
    };

export interface DraftChangesCatalogueEntry {
  ref: DraftChangeRef;
  kind: DraftChangesCatalogueEntryKind;
  target: DraftChangesCatalogueTarget;
  classification: DraftChangesCatalogueClassification;
  path?: string;
  previousPath?: string;
  before?: JsonValue;
  after?: JsonValue;
  beforeExists: boolean;
  afterExists: boolean;
  selectable: boolean;
  effectRefs?: SchemaEffectRef[];
}

export interface DraftChangesIdentityBinding {
  kind: 'table' | 'row';
  tableCreatedId: string;
  entityCreatedId: string;
  headIds: string[];
  draftIds: string[];
}

export interface DraftChangesCatalogueScope {
  fingerprint: string;
  branchId: string;
  headRevisionId: string;
  draftRevisionId: string;
}

export interface DraftChangesCatalogue {
  scope: DraftChangesCatalogueScope;
  identityBindings: DraftChangesIdentityBinding[];
  fieldBoundaries: DraftChangesFieldBoundary[];
  entries: DraftChangesCatalogueEntry[];
}

export interface DraftChangesFieldBoundary {
  tableCreatedId: string;
  kind: 'array' | 'file' | 'computed';
  path: string;
}

export interface BuildDraftChangesCatalogueQueryData {
  snapshot: DraftChangesSnapshot;
  schemaProjections: Array<{
    tableCreatedId: string;
    projection: ProjectDraftChangesSchemaResult;
  }>;
}

export interface DraftChangesCatalogueBlocker {
  code:
    | 'SCHEMA_PROJECTION_BLOCKED'
    | 'SCHEMA_PROJECTION_SNAPSHOT_MISMATCH'
    | 'SCHEMA_PROJECTION_TABLE_MISMATCH'
    | 'SCHEMA_PROJECTION_MISMATCH'
    | 'AMBIGUOUS_PATH'
    | 'AMBIGUOUS_IDENTITY'
    | 'INVALID_SNAPSHOT';
  message: string;
  tableCreatedId?: string;
}

export type BuildDraftChangesCatalogueResult =
  | { status: 'catalogued'; catalogue: DraftChangesCatalogue }
  | { status: 'blocked'; blockers: DraftChangesCatalogueBlocker[] };

export class BuildDraftChangesCatalogueQuery {
  constructor(public readonly data: BuildDraftChangesCatalogueQueryData) {}
}
