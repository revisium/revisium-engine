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
import { deeplyNestedCursor } from '../../__tests__/support/hostile-cursors';

const LONGEST_ID = 'i'.repeat(64);

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

  it.each([
    { tableId: 'notes', headOnly: true },
    { tableId: 'say "hi" C:\\notes\\', headOnly: false },
    { tableId: LONGEST_ID, headOnly: false },
  ])('decodes the position it encodes for $tableId', (position) => {
    expect(decodeTableCursor(encodeTableCursor(position))).toEqual(position);
  });

  it('refuses a deeply nested cursor without exhausting the stack', () => {
    expect(() => decodeTableCursor(deeplyNestedCursor('tables'))).toThrow(
      MALFORMED_AFTER,
    );
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
  it.each([
    { table: { tableId: 'notes', headOnly: true }, rowId: 'n/1' },
    {
      table: { tableId: 'say "hi"', headOnly: false },
      rowId: 'C:\\n"1\\',
    },
    { table: { tableId: LONGEST_ID, headOnly: false }, rowId: LONGEST_ID },
  ])('decodes the position it encodes for $rowId', (position) => {
    expect(decodeRowCursor(encodeRowCursor(position))).toEqual(position);
  });

  it('refuses a deeply nested cursor without exhausting the stack', () => {
    expect(() => decodeRowCursor(deeplyNestedCursor('rows'))).toThrow(
      MALFORMED_AFTER,
    );
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
