import {
  encodeRowCursor,
  encodeTableCursor,
} from 'src/features/partial-changes/draft-reads/draft-cursor';
import {
  encodeCursor,
  MAX_CURSOR_LENGTH,
} from 'src/features/partial-changes/input/cursor-codec';
import {
  decodeListingCursor,
  encodeListingCursor,
  type ListingCursor,
} from 'src/features/partial-changes/listing/listing-cursor';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';
import { deeplyNestedCursor } from '../../__tests__/support/hostile-cursors';

const MAX_ID_LENGTH = 64;

const cursorInsideRow: ListingCursor = {
  tableId: 'products',
  last: {
    key: '["field","t1","r1","/size/width"]',
    unit: {
      kind: 'field',
      tableId: 'products',
      rowId: 'é-1',
      path: '/size/width',
    },
  },
  rows: { rowId: 'é-1', inclusive: true },
};

const cursorAfterTableUnit: ListingCursor = {
  tableId: 'goods',
  last: {
    key: '["structure","t1"]',
    unit: { kind: 'structure', tableId: 'goods', previousTableId: 'products' },
  },
};

const cursorAfterRowsWithoutUnits: ListingCursor = {
  tableId: 'products',
  rows: { rowId: 'p4', inclusive: false },
};

const cursorAfterRowRename: ListingCursor = {
  tableId: 'products',
  last: {
    key: '["rowRename","t1","p2"]',
    unit: {
      kind: 'rowRename',
      tableId: 'products',
      rowId: 'p2',
      previousTableId: 'goods',
      previousRowId: 'p1',
    },
  },
};

const validPosition = {
  key: '["structure","t1"]',
  unit: { kind: 'structure', tableId: 'goods' },
};

describe('ListingCursor', () => {
  it.each([
    { position: 'inside a row', cursor: cursorInsideRow },
    { position: 'after a table-level unit', cursor: cursorAfterTableUnit },
    {
      position: 'after rows that listed no unit',
      cursor: cursorAfterRowsWithoutUnits,
    },
    { position: 'after a renamed row', cursor: cursorAfterRowRename },
    { position: 'at the start of a table', cursor: { tableId: 'goods' } },
    {
      position: 'with ids holding quotes and backslashes',
      cursor: cursorWithIds('say "hi"\\', 'C:\\goods"'),
    },
    {
      position: 'with ids and a field path of the longest a cursor allows',
      cursor: longestCursor(),
    },
  ])('decodes the cursor it encoded $position', ({ cursor }) => {
    expect(decodeListingCursor(encodeListingCursor(cursor))).toEqual(cursor);
  });

  it('encodes the longest position within the cursor length limit', () => {
    expect(encodeListingCursor(longestCursor()).length).toBeLessThanOrEqual(
      MAX_CURSOR_LENGTH,
    );
  });

  it('refuses a cursor nested deeper than any position without exhausting the stack', () => {
    expect(() => decodeListingCursor(deeplyNestedCursor('units'))).toThrow(
      new ListingValidationError('cursor is malformed'),
    );
  });

  it('refuses a cursor longer than the limit', () => {
    const cursor = encodeListingCursor({
      tableId: 'goods',
      rows: { rowId: 'g'.repeat(MAX_CURSOR_LENGTH), inclusive: false },
    });

    expect(() => decodeListingCursor(cursor)).toThrow(
      new ListingValidationError('cursor is malformed'),
    );
  });

  it('encodes an opaque URL-safe text', () => {
    expect(encodeListingCursor(cursorInsideRow)).toMatch(/^[\w-]+$/);
  });

  it.each([
    {
      operation: 'the table read',
      cursor: encodeTableCursor({ tableId: 'goods', headOnly: false }),
    },
    {
      operation: 'the row read',
      cursor: encodeRowCursor({
        table: { tableId: 'goods', headOnly: false },
        rowId: 'g1',
      }),
    },
  ])('refuses a cursor of $operation', ({ cursor }) => {
    expect(() => decodeListingCursor(cursor)).toThrow(
      new ListingValidationError('cursor is malformed'),
    );
  });

  it.each([
    { malformation: 'an empty text', text: '' },
    { malformation: 'a text that is not base64url', text: 'not a cursor' },
    { malformation: 'a text that is not JSON', text: encoded('{"v":') },
    {
      malformation: 'a cursor of the format before cursor kinds',
      text: encodedJson({ v: 1, tableId: 'goods', last: validPosition }),
    },
    {
      malformation: 'a cursor without the table to resume from',
      text: listingPayload({ last: validPosition }),
    },
    {
      malformation: 'a position without a unit key',
      text: listingPayload({
        tableId: 'goods',
        last: { unit: validPosition.unit },
      }),
    },
    {
      malformation: 'a unit whose table id is not a string',
      text: listingPayload({
        tableId: 'goods',
        last: { key: validPosition.key, unit: { kind: 'field', tableId: 7 } },
      }),
    },
    {
      malformation: 'a row bound without its inclusive flag',
      text: listingPayload({ tableId: 'goods', rows: { rowId: 'r1' } }),
    },
    {
      malformation: 'an unknown part',
      text: listingPayload({ tableId: 'goods', headOnly: false }),
    },
    {
      malformation: 'an unknown part of the row bound',
      text: listingPayload({
        tableId: 'goods',
        rows: { rowId: 'r1', inclusive: true, headOnly: false },
      }),
    },
    {
      malformation: 'an unknown part of the position',
      text: listingPayload({
        tableId: 'goods',
        last: { ...validPosition, selector: {} },
      }),
    },
    {
      malformation: 'an unknown part of the unit',
      text: listingPayload({
        tableId: 'goods',
        last: {
          ...validPosition,
          unit: { ...validPosition.unit, side: 'head' },
        },
      }),
    },
  ])('refuses $malformation', ({ text }) => {
    expect(() => decodeListingCursor(text)).toThrow(
      new ListingValidationError('cursor is malformed'),
    );
  });

  it.each([
    { part: 'tableId', cursor: { ...cursorInsideRow, tableId: 'p\u0000' } },
    {
      part: 'rows.rowId',
      cursor: {
        ...cursorInsideRow,
        rows: { rowId: 'é\u0000', inclusive: true },
      },
    },
    {
      part: 'last.key',
      cursor: withLast(cursorInsideRow, { key: '["field"\u0000]' }),
    },
    ...(
      ['tableId', 'rowId', 'path', 'previousTableId', 'previousRowId'] as const
    ).map((part) => ({
      part: `last.unit.${part}`,
      cursor: withLastUnit(cursorAfterRowRename, { [part]: 'x\u0000' }),
    })),
  ])('refuses the NUL character in $part', ({ cursor }) => {
    expect(() => decodeListingCursor(encodeListingCursor(cursor))).toThrow(
      new ListingValidationError('cursor is malformed'),
    );
  });
});

function cursorWithIds(tableId: string, rowId: string): ListingCursor {
  return {
    tableId,
    rows: { rowId, inclusive: true },
    last: {
      key: JSON.stringify(['field', tableId, rowId, '/a']),
      unit: { kind: 'field', tableId, rowId, path: '/a' },
    },
  };
}

// Ids of at most 64 characters, a field path of 64 names of 63 characters.
function longestCursor(): ListingCursor {
  const id = 'i'.repeat(MAX_ID_LENGTH);
  const path = `/${'f'.repeat(MAX_ID_LENGTH - 1)}`.repeat(MAX_ID_LENGTH);

  return {
    tableId: id,
    rows: { rowId: id, inclusive: false },
    last: {
      key: JSON.stringify(['field', id, id, path]),
      unit: {
        kind: 'field',
        tableId: id,
        rowId: id,
        path,
        previousTableId: id,
        previousRowId: id,
      },
    },
  };
}

function withLast(
  cursor: ListingCursor,
  fields: Partial<NonNullable<ListingCursor['last']>>,
): ListingCursor {
  const last = cursor.last;

  if (!last) {
    throw new Error('the cursor has no last position');
  }

  return { ...cursor, last: { ...last, ...fields } };
}

function withLastUnit(
  cursor: ListingCursor,
  fields: Readonly<Record<string, string>>,
): ListingCursor {
  const last = cursor.last;

  if (!last) {
    throw new Error('the cursor has no last position');
  }

  return withLast(cursor, { unit: { ...last.unit, ...fields } });
}

function listingPayload(parts: Readonly<Record<string, unknown>>): string {
  return encodeCursor('units', parts);
}

function encodedJson(payload: unknown): string {
  return encoded(JSON.stringify(payload));
}

function encoded(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}
