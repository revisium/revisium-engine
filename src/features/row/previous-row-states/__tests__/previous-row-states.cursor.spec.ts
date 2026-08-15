import { BadRequestException } from '@nestjs/common';
import {
  decodePreviousRowStatesCursor,
  encodePreviousRowStatesCursor,
  type PreviousRowStatesCursor,
} from 'src/features/row/previous-row-states/previous-row-states.cursor';

describe('Previous row states cursor', () => {
  const encoded =
    'eyJ0aXBSZXZpc2lvbklkIjoidGlwLXJldmlzaW9uIiwidGFibGVDcmVhdGVkSWQiOiJ0YWJsZS1jcmVhdGVkIiwicm93Q3JlYXRlZElkIjoicm93LWNyZWF0ZWQiLCJldmVudFJldmlzaW9uSWQiOiJldmVudC1yZXZpc2lvbiIsInNlcXVlbmNlIjoyfQ';
  const cursor: PreviousRowStatesCursor = {
    tipRevisionId: 'tip-revision',
    tableCreatedId: 'table-created',
    rowCreatedId: 'row-created',
    eventRevisionId: 'event-revision',
    sequence: 2,
  };

  it('round-trips the payload', () => {
    expect(encodePreviousRowStatesCursor(cursor)).toBe(encoded);
    expect(decodePreviousRowStatesCursor(encoded)).toEqual(cursor);
  });

  it.each([
    '',
    'not-json',
    // any unknown key rejects, including a versioned cursor from older builds
    encode({ ...cursor, v: 1 }),
    encode({ ...cursor, sequence: 0 }),
    encode({ ...cursor, sequence: Number.MAX_SAFE_INTEGER }),
    encode({ ...cursor, rowCreatedId: '' }),
  ])('rejects a foreign cursor payload', (value) => {
    expect(() => decodePreviousRowStatesCursor(value)).toThrow(
      BadRequestException,
    );
  });
});

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
