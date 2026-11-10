import type {
  RefusalCode,
  RefusedTable,
} from 'src/features/partial-changes/head-schema/head-schema-check';
import type { ChangeType } from 'src/features/revision-changes/types';

export interface DraftTableChangesFilters {
  readonly changeTypes?: readonly ChangeType[] | null;
  readonly search?: string | null;
}

export interface DraftReadState {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly refusedTables: readonly RefusedTable[];
}

export interface DraftPageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

export interface DraftEdge<T> {
  readonly cursor: string;
  readonly node: T;
}

export interface RefusedSelection {
  readonly state: 'refused';
  readonly code: RefusalCode;
}
