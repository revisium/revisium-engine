import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type {
  DraftChangeRef,
  DraftChangesCatalogue,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type {
  DiscardedDataField,
  SchemaEffectRef,
  SchemaProjectionBlocker,
} from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { ResolveDraftChangesSelectionResult } from 'src/features/draft-changes/queries/impl/resolve-draft-changes-selection.query';

export type ResolvedDraftChangesSelection = Extract<
  ResolveDraftChangesSelectionResult,
  { status: 'resolved' }
>;

export type CalculateDataCandidatesQueryData =
  | {
      snapshot: DraftChangesSnapshot;
      operation: 'discard';
      mode: 'restoreHead';
    }
  | {
      snapshot: DraftChangesSnapshot;
      operation: 'commit' | 'discard';
      mode: 'selected';
      catalogue: DraftChangesCatalogue;
      selection: ResolvedDraftChangesSelection;
    };

export type CandidateRequirement = {
  role: 'head' | 'draft';
  causeRef: DraftChangeRef;
} & (
  | { kind: 'catalogueEffects'; refs: DraftChangeRef[] }
  | {
      kind: 'schemaEffects';
      tableCreatedId: string;
      effects: SchemaEffectRef[];
    }
  | {
      kind: 'discardDataFields';
      tableCreatedId: string;
      fields: DiscardedDataField[];
    }
);

export interface CandidateBlocker {
  code:
    | 'SCOPE_MISMATCH'
    | 'INVALID_SELECTION'
    | 'IDENTITY_CONFLICT'
    | 'INVALID_RESULT_DATA'
    | 'SCHEMA_PROJECTION_BLOCKED'
    | 'EXCLUDED_PREREQUISITE';
  message: string;
  role?: 'head' | 'draft';
  tableCreatedId?: string;
  rowCreatedId?: string;
  identityScope?: 'tableId' | 'rowId';
  identityId?: string;
  path?: string;
  schemaBlocker?: SchemaProjectionBlocker;
}

export type CalculateDataCandidatesResult =
  | {
      status: 'calculated';
      head: DraftRevisionState;
      draft: DraftRevisionState;
      migrationLedger: 'deferred';
    }
  | { status: 'needsEffects'; requirements: CandidateRequirement[] }
  | { status: 'blocked'; blockers: CandidateBlocker[] };

export class CalculateDataCandidatesQuery {
  constructor(public readonly data: CalculateDataCandidatesQueryData) {}
}
