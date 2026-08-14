import type { JsonValue } from 'src/engine-prisma-types';
import type { RowStateIntroductionType } from 'src/features/row/queries/impl/get-previous-row-states.query';

/** Raw PostgreSQL projection before application-level validation. */
export interface PreviousRowStateSqlResult {
  selectorCount: number;
  projectId: string | null;
  tableCreatedId: string | null;
  rowCreatedId: string | null;
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
  eventDepth: number | null;
  introducedBy: RowStateIntroductionType[] | null;
  rowVersionId: string | null;
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

export type PreviousRowStatesSqlParams = {
  readonly revisionId: string;
  readonly tableId: string;
  readonly rowId: string;
  readonly first: number;
  readonly afterDepth: number | null;
  readonly afterRevisionId: string | null;
};
