import {
  compareTablePositions,
  decodeRowCursor,
  decodeTableCursor,
  encodeRowCursor,
  encodeTableCursor,
  type TablePosition,
} from 'src/features/partial-changes/draft-reads/draft-cursor';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';

describe('Draft table cursor', () => {
  it('orders positions by table id in code points, then the Head-only table first', () => {
    const positions: TablePosition[] = [
      { tableId: 'a', headOnly: false },
      { tableId: 'a', headOnly: true },
      { tableId: '_a', headOnly: false },
      { tableId: 'B', headOnly: false },
    ];

    expect([...positions].sort(compareTablePositions)).toEqual([
      { tableId: 'B', headOnly: false },
      { tableId: '_a', headOnly: false },
      { tableId: 'a', headOnly: true },
      { tableId: 'a', headOnly: false },
    ]);
  });

  it('decodes the position it encodes', () => {
    const position = { tableId: 'notes', headOnly: true };

    expect(decodeTableCursor(encodeTableCursor(position))).toEqual(position);
  });

  it.each(['', 'not a cursor', 'eyJ2Ijo', '10'])(
    'refuses the malformed cursor %p',
    (cursor) => {
      expect(() => decodeTableCursor(cursor)).toThrow(ListingValidationError);
    },
  );

  it('refuses the cursor of a row page', () => {
    const cursor = encodeRowCursor({
      table: { tableId: 'notes', headOnly: false },
      rowId: 'n1',
    });

    expect(() => decodeTableCursor(cursor)).toThrow(ListingValidationError);
  });
});

describe('Draft row cursor', () => {
  it('decodes the position it encodes', () => {
    const position = {
      table: { tableId: 'notes', headOnly: true },
      rowId: 'n/1',
    };

    expect(decodeRowCursor(encodeRowCursor(position))).toEqual(position);
  });

  it.each(['', 'not a cursor', 'eyJ2Ijo', '10'])(
    'refuses the malformed cursor %p',
    (cursor) => {
      expect(() => decodeRowCursor(cursor)).toThrow(ListingValidationError);
    },
  );

  it('refuses the cursor of a table page', () => {
    const cursor = encodeTableCursor({ tableId: 'notes', headOnly: false });

    expect(() => decodeRowCursor(cursor)).toThrow(ListingValidationError);
  });
});
