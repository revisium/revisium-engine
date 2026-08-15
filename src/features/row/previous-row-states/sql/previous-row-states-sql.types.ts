import type { JsonValue } from 'src/engine-prisma-types';
import type { RowStateIntroductionType } from 'src/features/row/queries/impl/get-previous-row-states.query';

export type HistorySelectorSqlParams = {
  readonly revisionId: string;
  readonly tableId: string;
  readonly rowId: string;
};

/**
 * Selected-snapshot resolution: the tip Revision, identities, uniqueness,
 * and the version count (capped just past the strategy threshold).
 */
export interface HistorySelectorSqlResult {
  tipIsDraft: boolean;
  tipBranchId: string;
  tipSequence: number;
  projectId: string;
  selectorCount: number;
  tableCreatedId: string | null;
  rowCreatedId: string | null;
  rowVersionCount: number;
}

export type PreviousRowStatesSqlParams = {
  readonly tipBranchId: string;
  readonly tipSequence: number;
  readonly projectId: string;
  readonly tableCreatedId: string;
  readonly rowCreatedId: string;
  /** Total Row versions sharing the stable identity; picks the algorithm. */
  readonly rowVersionCount: number;
  readonly first: number;
  readonly afterSequence: number | null;
  readonly afterRevisionId: string | null;
};

/** Raw PostgreSQL projection before application-level validation. */
export interface PreviousRowStateSqlResult {
  hasCycle: boolean;
  hasGap: boolean;
  hasDraft: boolean;
  crossesProject: boolean;
  duplicateTable: boolean;
  duplicateRow: boolean;
  rowReappears: boolean;
  cursorValid: boolean;
  totalCount: bigint | number;
  hasNextPage: boolean;
  eventRevisionId: string | null;
  eventSequence: number | null;
  introducedBy: RowStateIntroductionType[] | null;
  rowVersionId: string | null;
  rowCreatedId: string | null;
  rowId: string | null;
  rowReadonly: boolean | null;
  rowCreatedAt: Date | null;
  rowUpdatedAt: Date | null;
  rowPublishedAt: Date | null;
  rowData: JsonValue | null;
  rowMeta: JsonValue | null;
  rowHash: string | null;
  rowSchemaHash: string | null;
  nodeTableVersionId: string | null;
  tableCreatedId: string | null;
  nodeTableId: string | null;
  tableReadonly: boolean | null;
  tableCreatedAt: Date | null;
  tableUpdatedAt: Date | null;
  tableSystem: boolean | null;
  revisionSequence: number | null;
  revisionCreatedAt: Date | null;
  revisionComment: string | null;
  revisionIsHead: boolean | null;
  revisionIsDraft: boolean | null;
  revisionIsStart: boolean | null;
  revisionHasChanges: boolean | null;
  revisionBranchId: string | null;
  revisionParentId: string | null;
  branchId: string | null;
  branchCreatedAt: Date | null;
  branchIsRoot: boolean | null;
  branchName: string | null;
  branchProjectId: string | null;
}
