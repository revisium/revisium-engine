import { BadRequestException } from '@nestjs/common';
import {
  decodePreviousRowStatesCursor,
  encodePreviousRowStatesCursor,
  type PreviousRowStatesCursorV1,
} from 'src/features/row/previous-row-states/previous-row-states.cursor';

describe('Previous row states cursor v1', () => {
  const encodedV1 =
    'eyJ2IjoxLCJ0aXBSZXZpc2lvbklkIjoidGlwLXJldmlzaW9uIiwidGFibGVDcmVhdGVkSWQiOiJ0YWJsZS1jcmVhdGVkIiwicm93Q3JlYXRlZElkIjoicm93LWNyZWF0ZWQiLCJldmVudFJldmlzaW9uSWQiOiJldmVudC1yZXZpc2lvbiIsImRlcHRoIjoyfQ';
  const cursor: PreviousRowStatesCursorV1 = {
    v: 1,
    tipRevisionId: 'tip-revision',
    tableCreatedId: 'table-created',
    rowCreatedId: 'row-created',
    eventRevisionId: 'event-revision',
    depth: 2,
  };

  it('round-trips the existing v1 payload', () => {
    expect(encodePreviousRowStatesCursor(cursor)).toBe(encodedV1);
    expect(decodePreviousRowStatesCursor(encodedV1)).toEqual(cursor);
  });

  it.each([
    '',
    'not-json',
    encode({ ...cursor, v: 2 }),
    encode({ ...cursor, depth: 0 }),
    encode({ ...cursor, extra: true }),
    encode({ ...cursor, rowCreatedId: '' }),
  ])('rejects a non-v1 cursor payload', (value) => {
    expect(() => decodePreviousRowStatesCursor(value)).toThrow(
      BadRequestException,
    );
  });
});

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
