import { BadRequestException } from '@nestjs/common';
import type {
  GetPreviousRowStatesQueryReturnType,
  PreviousRowStateNode,
} from 'src/features/row/queries/impl/get-previous-row-states.query';
import {
  type ParsedPreviousRowStatesRequest,
  throwPreviousRowStatesCursorScopeError,
} from 'src/features/row/services/previous-row-states.request';
import type { PreviousRowStateSqlResult } from 'src/features/row/utils/get-previous-row-states-sql';
import {
  encodePreviousRowStatesCursor,
  type PreviousRowStatesCursorV1,
} from 'src/features/row/utils/previous-row-states-cursor';

export function interpretPreviousRowStatesResult({
  request,
  rows,
}: {
  request: ParsedPreviousRowStatesRequest;
  rows: readonly PreviousRowStateSqlResult[];
}): GetPreviousRowStatesQueryReturnType {
  const metadata = rows[0];
  if (!metadata || metadata.selectorCount === 0) {
    if (request.after) {
      throwPreviousRowStatesCursorScopeError();
    }
    return null;
  }

  assertIntegrity(metadata);
  assertCursor(request.after, metadata);

  const edges = rows
    .filter(
      (
        row,
      ): row is PreviousRowStateSqlResult & {
        eventRevisionId: string;
        eventDepth: number;
      } => row.eventRevisionId !== null && row.eventDepth !== null,
    )
    .map((row) => {
      const cursor = encodePreviousRowStatesCursor({
        v: 1,
        tipRevisionId: request.revisionId,
        tableCreatedId: metadata.tableCreatedId as string,
        rowCreatedId: metadata.rowCreatedId as string,
        eventRevisionId: row.eventRevisionId,
        depth: row.eventDepth,
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
  if (metadata.selectorCount !== 1) {
    throw new BadRequestException(
      'Selected row snapshot must resolve exactly once',
    );
  }
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
  after: PreviousRowStatesCursorV1 | null,
  metadata: PreviousRowStateSqlResult,
): void {
  if (!after) {
    return;
  }

  if (
    after.tableCreatedId !== metadata.tableCreatedId ||
    after.rowCreatedId !== metadata.rowCreatedId ||
    !metadata.cursorValid
  ) {
    throwPreviousRowStatesCursorScopeError();
  }
}

function toNode(row: PreviousRowStateSqlResult): PreviousRowStateNode {
  if (
    !row.introducedBy ||
    !row.rowVersionId ||
    !row.rowId ||
    row.rowReadonly === null ||
    !row.rowCreatedAt ||
    !row.rowUpdatedAt ||
    !row.rowPublishedAt ||
    row.rowHash === null ||
    row.rowSchemaHash === null ||
    !row.nodeTableVersionId ||
    !row.nodeTableId ||
    row.tableReadonly === null ||
    !row.tableCreatedAt ||
    !row.tableUpdatedAt ||
    row.tableSystem === null ||
    !row.eventRevisionId ||
    row.revisionSequence === null ||
    !row.revisionCreatedAt ||
    row.revisionComment === null ||
    row.revisionIsHead === null ||
    row.revisionIsDraft === null ||
    row.revisionIsStart === null ||
    row.revisionHasChanges === null ||
    !row.revisionBranchId ||
    !row.branchId ||
    !row.branchCreatedAt ||
    row.branchIsRoot === null ||
    row.branchName === null ||
    row.branchProjectId === null
  ) {
    throw new Error('Previous row state hydration is incomplete');
  }

  return {
    row: {
      versionId: row.rowVersionId,
      createdId: row.rowCreatedId as string,
      id: row.rowId,
      readonly: row.rowReadonly,
      createdAt: row.rowCreatedAt,
      updatedAt: row.rowUpdatedAt,
      publishedAt: row.rowPublishedAt,
      data: row.rowData,
      meta: row.rowMeta,
      hash: row.rowHash,
      schemaHash: row.rowSchemaHash,
    },
    table: {
      versionId: row.nodeTableVersionId,
      createdId: row.tableCreatedId as string,
      id: row.nodeTableId,
      readonly: row.tableReadonly,
      createdAt: row.tableCreatedAt,
      updatedAt: row.tableUpdatedAt,
      system: row.tableSystem,
    },
    revision: {
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
    },
    branch: {
      id: row.branchId,
      createdAt: row.branchCreatedAt,
      isRoot: row.branchIsRoot,
      name: row.branchName,
      projectId: row.branchProjectId,
    },
    introducedBy: row.introducedBy,
  };
}
