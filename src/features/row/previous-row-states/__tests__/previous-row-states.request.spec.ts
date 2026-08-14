import { BadRequestException } from '@nestjs/common';
import {
  parsePreviousRowStatesRequest,
  throwPreviousRowStatesCursorScopeError,
} from 'src/features/row/previous-row-states/previous-row-states.request';
import { encodePreviousRowStatesCursor } from 'src/features/row/previous-row-states/previous-row-states.cursor';

describe('Previous row states request', () => {
  const cursor = encodePreviousRowStatesCursor({
    v: 1,
    tipRevisionId: 'revision',
    tableCreatedId: 'table-created',
    rowCreatedId: 'row-created',
    eventRevisionId: 'event-revision',
    depth: 2,
  });

  it('parses a valid request and strict cursor', () => {
    expect(
      parsePreviousRowStatesRequest({
        revisionId: 'revision',
        tableId: 'table',
        rowId: 'row',
        first: 10,
        after: cursor,
      }),
    ).toEqual({
      revisionId: 'revision',
      tableId: 'table',
      rowId: 'row',
      first: 10,
      after: {
        v: 1,
        tipRevisionId: 'revision',
        tableCreatedId: 'table-created',
        rowCreatedId: 'row-created',
        eventRevisionId: 'event-revision',
        depth: 2,
      },
    });
  });

  it('validates first before decoding the cursor', () => {
    expect(() =>
      parsePreviousRowStatesRequest({
        revisionId: 'revision',
        tableId: 'table',
        rowId: 'row',
        first: 0,
        after: 'malformed',
      }),
    ).toThrow('first must be an integer from 1 to 100');
  });

  it('rejects malformed and different-tip cursors with existing errors', () => {
    expect(() =>
      parsePreviousRowStatesRequest({
        revisionId: 'revision',
        tableId: 'table',
        rowId: 'row',
        first: 10,
        after: 'malformed',
      }),
    ).toThrow('Invalid previous row states cursor');

    expect(() =>
      parsePreviousRowStatesRequest({
        revisionId: 'other-revision',
        tableId: 'table',
        rowId: 'row',
        first: 10,
        after: cursor,
      }),
    ).toThrow('Previous row states cursor does not belong to this result');
  });

  it('provides the shared cursor scope error', () => {
    expect(throwPreviousRowStatesCursorScopeError).toThrow(BadRequestException);
  });
});
