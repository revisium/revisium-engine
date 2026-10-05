import type { JsonValue } from '@revisium/schema-toolkit/types';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type {
  DraftChangeRef,
  DraftChangesCatalogue,
  DraftChangesCatalogueTarget,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type {
  CandidateSchemaProjectionBinding,
  ResolvedDraftChangesSelection,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';

export type CandidateViewTarget = Extract<
  DraftChangesCatalogueTarget,
  { kind: 'view' | 'viewConfiguration' }
>;

export interface CandidateViewEffect {
  role: 'head' | 'draft';
  target: CandidateViewTarget;
  beforeExists: boolean;
  afterExists: boolean;
  before?: JsonValue;
  after?: JsonValue;
}

export interface CandidateViewRequirement {
  role: 'head' | 'draft';
  causeRef: DraftChangeRef;
  refs: DraftChangeRef[];
}

export type CandidateViewBlockerCode =
  | 'INVALID_VIEW_DATA'
  | 'AMBIGUOUS_VIEW_RESIDUAL'
  | 'INVALID_VIEW_IDENTITY'
  | 'SCHEMA_PROJECTION_BLOCKED'
  | 'SCOPE_MISMATCH'
  | 'INVALID_SELECTION'
  | 'EXCLUDED_PREREQUISITE';

export interface CandidateViewBlocker {
  code: CandidateViewBlockerCode;
  message: string;
  tableCreatedId?: string;
  viewId?: string;
  component?: CandidateViewTarget['component'];
  path?: string;
}

export type ResolveCandidateViewsQueryData =
  | {
      mode: 'restoreHead';
      snapshot: DraftChangesSnapshot;
      head: DraftRevisionState;
      draft: DraftRevisionState;
    }
  | {
      mode: 'selected';
      snapshot: DraftChangesSnapshot;
      operation: 'commit' | 'discard';
      catalogue: DraftChangesCatalogue;
      selection: ResolvedDraftChangesSelection;
      effectiveRefs: DraftChangeRef[];
      schemaProjectionBindings: CandidateSchemaProjectionBinding[];
      head: DraftRevisionState;
      draft: DraftRevisionState;
    };

export type ResolveCandidateViewsResult =
  | {
      status: 'projected';
      head: DraftRevisionState;
      draft: DraftRevisionState;
      effects: CandidateViewEffect[];
    }
  | { status: 'needsEffects'; requirements: CandidateViewRequirement[] }
  | { status: 'blocked'; blockers: CandidateViewBlocker[] };

export class ResolveCandidateViewsQuery {
  constructor(public readonly data: ResolveCandidateViewsQueryData) {}
}
