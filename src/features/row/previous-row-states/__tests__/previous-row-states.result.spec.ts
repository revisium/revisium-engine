import type { ParsedPreviousRowStatesRequest } from 'src/features/row/previous-row-states/previous-row-states.request';
import {
  interpretPreviousRowStatesResult,
  type ResolvedHistorySelector,
} from 'src/features/row/previous-row-states/previous-row-states.result';
import type { PreviousRowStateSqlResult } from 'src/features/row/previous-row-states/sql/get-previous-row-states.sql';

describe('Previous row states result', () => {
  const request: ParsedPreviousRowStatesRequest = {
    revisionId: 'tip-revision',
    tableId: 'table',
    rowId: 'row',
    first: 10,
    after: null,
  };
  const selector: ResolvedHistorySelector = {
    tableCreatedId: 'table-created',
    rowCreatedId: 'row-created',
  };

  it('projects hydrated rows into the public connection', () => {
    const row = createRawRow();

    const result = interpretPreviousRowStatesResult({
      request,
      selector,
      rows: [row],
    });

    expect(result).toEqual({
      edges: [
        {
          cursor: expect.any(String),
          node: {
            row: {
              versionId: 'row-version',
              createdId: 'row-created',
              id: 'row',
              readonly: false,
              createdAt: row.rowCreatedAt,
              updatedAt: row.rowUpdatedAt,
              publishedAt: row.rowPublishedAt,
              data: { value: 'A' },
              meta: {},
              hash: 'hash',
              schemaHash: 'schema-hash',
            },
            table: {
              versionId: 'table-version',
              createdId: 'table-created',
              id: 'table',
              readonly: false,
              createdAt: row.tableCreatedAt,
              updatedAt: row.tableUpdatedAt,
              system: false,
            },
            revision: {
              id: 'event-revision',
              sequence: 2,
              createdAt: row.revisionCreatedAt,
              comment: '',
              isHead: false,
              isDraft: false,
              isStart: false,
              hasChanges: true,
              branchId: 'branch',
              parentId: 'parent-revision',
            },
            branch: {
              id: 'branch',
              createdAt: row.branchCreatedAt,
              isRoot: true,
              name: 'main',
              projectId: 'project',
            },
            introducedBy: ['created'],
          },
        },
      ],
      totalCount: 1,
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: expect.any(String),
        endCursor: expect.any(String),
      },
    });
  });

  it('checks full integrity before cursor membership', () => {
    const invalid = createRawRow({ hasCycle: true, cursorValid: false });

    expect(() =>
      interpretPreviousRowStatesResult({
        request: {
          ...request,
          after: {
            tipRevisionId: request.revisionId,
            tableCreatedId: 'table-created',
            rowCreatedId: 'row-created',
            eventRevisionId: 'event-revision',
            sequence: 2,
          },
        },
        selector,
        rows: [invalid],
      }),
    ).toThrow('Cycle in selected revision ancestry');
  });

  it('rejects a cursor whose identities or membership no longer match', () => {
    const rows = [createRawRow({ cursorValid: false })];

    expect(() =>
      interpretPreviousRowStatesResult({
        request: {
          ...request,
          after: {
            tipRevisionId: request.revisionId,
            tableCreatedId: 'table-created',
            rowCreatedId: 'row-created',
            eventRevisionId: 'event-revision',
            sequence: 2,
          },
        },
        selector,
        rows,
      }),
    ).toThrow('Previous row states cursor does not belong to this result');
  });

  it('rejects incomplete page hydration', () => {
    expect(() =>
      interpretPreviousRowStatesResult({
        request,
        selector,
        rows: [createRawRow({ rowVersionId: null })],
      }),
    ).toThrow('Previous row state hydration is incomplete');
  });
});

function createRawRow(
  overrides: Partial<PreviousRowStateSqlResult> = {},
): PreviousRowStateSqlResult {
  const date = new Date('2026-08-14T00:00:00.000Z');
  return {
    hasCycle: false,
    hasGap: false,
    hasDraft: false,
    crossesProject: false,
    duplicateTable: false,
    duplicateRow: false,
    rowReappears: false,
    cursorValid: true,
    totalCount: 1n,
    hasNextPage: false,
    eventRevisionId: 'event-revision',
    eventSequence: 2,
    introducedBy: ['created'],
    rowVersionId: 'row-version',
    rowCreatedId: 'row-created',
    rowId: 'row',
    rowReadonly: false,
    rowCreatedAt: date,
    rowUpdatedAt: date,
    rowPublishedAt: date,
    rowData: { value: 'A' },
    rowMeta: {},
    rowHash: 'hash',
    rowSchemaHash: 'schema-hash',
    nodeTableVersionId: 'table-version',
    tableCreatedId: 'table-created',
    nodeTableId: 'table',
    tableReadonly: false,
    tableCreatedAt: date,
    tableUpdatedAt: date,
    tableSystem: false,
    revisionSequence: 2,
    revisionCreatedAt: date,
    revisionComment: '',
    revisionIsHead: false,
    revisionIsDraft: false,
    revisionIsStart: false,
    revisionHasChanges: true,
    revisionBranchId: 'branch',
    revisionParentId: 'parent-revision',
    branchId: 'branch',
    branchCreatedAt: date,
    branchIsRoot: true,
    branchName: 'main',
    branchProjectId: 'project',
    ...overrides,
  };
}
