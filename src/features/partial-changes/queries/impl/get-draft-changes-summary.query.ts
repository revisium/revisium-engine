import type {
  DraftReadState,
  DraftTableChangesFilters,
} from 'src/features/partial-changes/queries/impl/draft-reads';
import type {
  DescribedUnitRef,
  UnitRef,
} from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type {
  ChangeType,
  RevisionChangeSummary,
} from 'src/features/revision-changes/types';

export interface DraftChangesSummaryInput {
  readonly branch: ChangesBranch;
  readonly filters?: DraftTableChangesFilters | null;
}

export interface ChangedSharedSchema {
  readonly sharedSchemaId: string;
  readonly changeType: ChangeType;
  readonly unit: UnitRef;
}

export interface TransientTable {
  readonly tableId: string;
  readonly changeType: ChangeType;
  readonly structure: DescribedUnitRef;
}

export interface ViewsOnlyTable {
  readonly tableId: string;
  readonly changeType: ChangeType;
  readonly views: UnitRef;
}

export interface DraftChangesSummary extends DraftReadState {
  readonly tablesSummary: RevisionChangeSummary & { readonly replaced: number };
  readonly rowsSummary: RevisionChangeSummary;
  readonly rowsWithUnits: number;
  readonly sharedSchemas: readonly ChangedSharedSchema[];
  readonly sharedSchemasCount: number;
  readonly transientTables: readonly TransientTable[];
  readonly transientTablesCount: number;
  readonly viewsOnlyTables: readonly ViewsOnlyTable[];
  readonly viewsOnlyTablesCount: number;
}

export class GetDraftChangesSummaryQuery {
  constructor(public readonly data: DraftChangesSummaryInput) {}
}
