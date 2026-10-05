import type {
  CandidateBlocker,
  CandidateRequirement,
  CalculateDataCandidatesQueryData,
  CalculateDataCandidatesResult,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftChangeRef } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';

export type ResolveCandidateDependenciesQueryData =
  CalculateDataCandidatesQueryData;

export type RequiredCandidateEffect = Extract<
  CandidateRequirement,
  { kind: 'catalogueEffects' | 'schemaEffects' }
>;

type CalculatedCandidate = Extract<
  CalculateDataCandidatesResult,
  { status: 'calculated' }
>;

export type AutomaticForeignKeyEffect =
  | {
      kind: 'rowForeignKey';
      role: 'head' | 'draft';
      tableCreatedId: string;
      rowCreatedId: string;
      targetTableCreatedId: string;
      targetRowCreatedId: string;
      path: string;
      before: string;
      after: string;
      causeRefs: DraftChangeRef[];
    }
  | {
      kind: 'schemaForeignKey';
      role: 'head' | 'draft';
      tableCreatedId: string;
      targetTableCreatedId: string;
      path: string;
      before: string;
      after: string;
      causeRefs: DraftChangeRef[];
    };

export interface CandidateDependencyBlocker {
  code:
    | 'MISSING_REFERENCE_TARGET'
    | 'AMBIGUOUS_REFERENCE_REPAIR'
    | 'EXCLUDED_REFERENCE_REWRITE'
    | 'EXCLUDED_PREREQUISITE'
    | 'UNREPRESENTABLE_REFERENCE';
  message: string;
  role: 'head' | 'draft';
  tableCreatedId: string;
  rowCreatedId?: string;
  path?: string;
  targetTableId?: string;
  targetRowId?: string;
}

export type ResolveCandidateDependenciesResult =
  | (Omit<CalculatedCandidate, 'status' | 'schemaForeignKeyChanges'> & {
      status: 'resolved';
      required: RequiredCandidateEffect[];
      automatic: AutomaticForeignKeyEffect[];
      effectiveRefs?: DraftChangeRef[];
    })
  | {
      status: 'blocked';
      blockers: Array<CandidateBlocker | CandidateDependencyBlocker>;
    };

export class ResolveCandidateDependenciesQuery {
  constructor(public readonly data: ResolveCandidateDependenciesQueryData) {}
}
