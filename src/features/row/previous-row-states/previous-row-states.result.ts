import { BadRequestException } from '@nestjs/common';
import type {
  GetPreviousRowStatesQueryReturnType,
  PreviousRowStateNode,
} from 'src/features/row/queries/impl/get-previous-row-states.query';
import {
  type ParsedPreviousRowStatesRequest,
  throwPreviousRowStatesCursorScopeError,
} from 'src/features/row/previous-row-states/previous-row-states.request';
import type { PreviousRowStateSqlResult } from 'src/features/row/previous-row-states/sql/get-previous-row-states.sql';
import {
  encodePreviousRowStatesCursor,
  type PreviousRowStatesCursor,
} from 'src/features/row/previous-row-states/previous-row-states.cursor';

/** Stable identities already resolved for the selected snapshot. */
export type ResolvedHistorySelector = {
  readonly tableCreatedId: string;
  readonly rowCreatedId: string;
};

export function interpretPreviousRowStatesResult({
  request,
  selector,
  rows,
}: {
  request: ParsedPreviousRowStatesRequest;
  selector: ResolvedHistorySelector;
  rows: readonly PreviousRowStateSqlResult[];
}): GetPreviousRowStatesQueryReturnType {
  // metadata is a cross join of always-one-row CTEs left-joined to the page,
  // so the statement yields at least one row even for an empty history;
  // anything else is an internal invariant violation, not an empty result.
  const metadata = rows[0];
  if (!metadata) {
    throw new Error('Previous row states metadata row is missing');
  }

  assertIntegrity(metadata);
  assertCursor(request.after, selector, metadata);

  const edges = rows
    .filter(
      (
        row,
      ): row is PreviousRowStateSqlResult & {
        eventRevisionId: string;
        eventSequence: number;
      } => row.eventRevisionId !== null && row.eventSequence !== null,
    )
    .map((row) => {
      const cursor = encodePreviousRowStatesCursor({
        tipRevisionId: request.revisionId,
        tableCreatedId: selector.tableCreatedId,
        rowCreatedId: selector.rowCreatedId,
        eventRevisionId: row.eventRevisionId,
        sequence: row.eventSequence,
      });
      return { cursor, node: toNode(row) };
    });

  return {
    edges,
    totalCount: Number(metadata.totalCount),
    pageInfo: {
      hasNextPage: metadata.hasNextPage,
      hasPreviousPage: request.after !== null,
      ...(edges[0] ? { startCursor: edges[0].cursor } : {}),
      ...(edges.at(-1) ? { endCursor: edges.at(-1)?.cursor } : {}),
    },
  };
}

function assertIntegrity(metadata: PreviousRowStateSqlResult): void {
  if (metadata.hasCycle) {
    throw new BadRequestException('Cycle in selected revision ancestry');
  }
  if (metadata.hasGap) {
    throw new BadRequestException('Broken selected revision ancestry');
  }
  if (metadata.hasDraft) {
    throw new BadRequestException(
      'Selected revision ancestry contains a Draft revision',
    );
  }
  if (metadata.crossesProject) {
    throw new BadRequestException(
      'Selected revision ancestry crosses projects',
    );
  }
  if (metadata.duplicateTable) {
    throw new BadRequestException('Duplicate logical table state');
  }
  if (metadata.duplicateRow) {
    throw new BadRequestException('Duplicate logical row state');
  }
  if (metadata.rowReappears) {
    throw new BadRequestException('Row identity disappears and reappears');
  }
}

function assertCursor(
  after: PreviousRowStatesCursor | null,
  selector: ResolvedHistorySelector,
  metadata: PreviousRowStateSqlResult,
): void {
  if (!after) {
    return;
  }

  if (
    after.tableCreatedId !== selector.tableCreatedId ||
    after.rowCreatedId !== selector.rowCreatedId ||
    !metadata.cursorValid
  ) {
    throwPreviousRowStatesCursorScopeError();
  }
}

function toNode(row: PreviousRowStateSqlResult): PreviousRowStateNode {
  if (!row.introducedBy) {
    return incompleteHydration();
  }

  return {
    row: mapRow(row),
    table: mapTable(row),
    revision: mapRevision(row),
    branch: mapBranch(row),
    introducedBy: row.introducedBy,
  };
}

function mapRow(row: PreviousRowStateSqlResult): PreviousRowStateNode['row'] {
  if (
    !row.rowVersionId ||
    !row.rowCreatedId ||
    !row.rowId ||
    row.rowReadonly === null ||
    !row.rowCreatedAt ||
    !row.rowUpdatedAt ||
    !row.rowPublishedAt ||
    row.rowHash === null ||
    row.rowSchemaHash === null
  ) {
    return incompleteHydration();
  }

  return {
    versionId: row.rowVersionId,
    createdId: row.rowCreatedId,
    id: row.rowId,
    readonly: row.rowReadonly,
    createdAt: row.rowCreatedAt,
    updatedAt: row.rowUpdatedAt,
    publishedAt: row.rowPublishedAt,
    data: row.rowData,
    meta: row.rowMeta,
    hash: row.rowHash,
    schemaHash: row.rowSchemaHash,
  };
}

function mapTable(
  row: PreviousRowStateSqlResult,
): PreviousRowStateNode['table'] {
  if (
    !row.nodeTableVersionId ||
    !row.tableCreatedId ||
    !row.nodeTableId ||
    row.tableReadonly === null ||
    !row.tableCreatedAt ||
    !row.tableUpdatedAt ||
    row.tableSystem === null
  ) {
    return incompleteHydration();
  }

  return {
    versionId: row.nodeTableVersionId,
    createdId: row.tableCreatedId,
    id: row.nodeTableId,
    readonly: row.tableReadonly,
    createdAt: row.tableCreatedAt,
    updatedAt: row.tableUpdatedAt,
    system: row.tableSystem,
  };
}

function mapRevision(
  row: PreviousRowStateSqlResult,
): PreviousRowStateNode['revision'] {
  if (
    !row.eventRevisionId ||
    row.revisionSequence === null ||
    !row.revisionCreatedAt ||
    row.revisionComment === null ||
    row.revisionIsHead === null ||
    row.revisionIsDraft === null ||
    row.revisionIsStart === null ||
    row.revisionHasChanges === null ||
    !row.revisionBranchId
  ) {
    return incompleteHydration();
  }

  return {
    id: row.eventRevisionId,
    sequence: row.revisionSequence,
    createdAt: row.revisionCreatedAt,
    comment: row.revisionComment,
    isHead: row.revisionIsHead,
    isDraft: row.revisionIsDraft,
    isStart: row.revisionIsStart,
    hasChanges: row.revisionHasChanges,
    branchId: row.revisionBranchId,
    parentId: row.revisionParentId,
  };
}

function mapBranch(
  row: PreviousRowStateSqlResult,
): PreviousRowStateNode['branch'] {
  if (
    !row.branchId ||
    !row.branchCreatedAt ||
    row.branchIsRoot === null ||
    row.branchName === null ||
    row.branchProjectId === null
  ) {
    return incompleteHydration();
  }

  return {
    id: row.branchId,
    createdAt: row.branchCreatedAt,
    isRoot: row.branchIsRoot,
    name: row.branchName,
    projectId: row.branchProjectId,
  };
}

function incompleteHydration(): never {
  throw new Error('Previous row state hydration is incomplete');
}
