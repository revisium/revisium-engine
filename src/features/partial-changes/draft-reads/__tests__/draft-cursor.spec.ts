import {
  compareTablePositions,
  decodeRowCursor,
  decodeTableCursor,
  encodeRowCursor,
  encodeTableCursor,
  type TablePosition,
} from 'src/features/partial-changes/draft-reads/draft-cursor';
import { encodeCursor } from 'src/features/partial-changes/input/cursor-codec';
import { encodeListingCursor } from 'src/features/partial-changes/listing/listing-cursor';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';

const MALFORMED_AFTER = new ListingValidationError(
  'after is malformed: pass the endCursor of the previous page',
);

const listingCursor = encodeListingCursor({
  tableId: 'notes',
  rows: { rowId: 'n1', inclusive: false },
});

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

    expect(() => decodeTableCursor(cursor)).toThrow(MALFORMED_AFTER);
  });

  it('refuses the cursor of the unit listing', () => {
    expect(() => decodeTableCursor(listingCursor)).toThrow(MALFORMED_AFTER);
  });

  it('refuses a cursor with an unknown part', () => {
    const cursor = encodeCursor('tables', {
      tableId: 'notes',
      headOnly: false,
      rows: { rowId: 'n1', inclusive: false },
    });

    expect(() => decodeTableCursor(cursor)).toThrow(MALFORMED_AFTER);
  });

  it('refuses the NUL character in the table id', () => {
    const cursor = encodeTableCursor({
      tableId: 'no\u0000tes',
      headOnly: false,
    });

    expect(() => decodeTableCursor(cursor)).toThrow(MALFORMED_AFTER);
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

    expect(() => decodeRowCursor(cursor)).toThrow(MALFORMED_AFTER);
  });

  it('refuses the cursor of the unit listing', () => {
    expect(() => decodeRowCursor(listingCursor)).toThrow(MALFORMED_AFTER);
  });

  it('refuses a cursor with an unknown part', () => {
    const cursor = encodeCursor('rows', {
      tableId: 'notes',
      headOnly: false,
      rowId: 'n1',
      inclusive: false,
    });

    expect(() => decodeRowCursor(cursor)).toThrow(MALFORMED_AFTER);
  });

  it.each([
    {
      part: 'table id',
      table: { tableId: 'no\u0000tes', headOnly: false },
      rowId: 'n1',
    },
    {
      part: 'row id',
      table: { tableId: 'notes', headOnly: false },
      rowId: 'n\u00001',
    },
  ])('refuses the NUL character in the $part', ({ table, rowId }) => {
    const cursor = encodeRowCursor({ table, rowId });

    expect(() => decodeRowCursor(cursor)).toThrow(MALFORMED_AFTER);
  });
});
