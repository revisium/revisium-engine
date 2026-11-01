import {
  decodeListingCursor,
  encodeListingCursor,
  type ListingCursor,
} from 'src/features/partial-changes/listing/listing-cursor';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';

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
  ])('decodes the cursor it encoded $position', ({ cursor }) => {
    expect(decodeListingCursor(encodeListingCursor(cursor))).toEqual(cursor);
  });

  it('encodes an opaque URL-safe text', () => {
    expect(encodeListingCursor(cursorInsideRow)).toMatch(/^[\w-]+$/);
  });

  it.each([
    { malformation: 'an empty text', text: '' },
    { malformation: 'a text that is not base64url', text: 'not a cursor' },
    { malformation: 'a text that is not JSON', text: encoded('{"v":') },
    {
      malformation: 'another version',
      text: encodedJson({ v: 2, tableId: 'goods', last: validPosition }),
    },
    {
      malformation: 'a cursor without the table to resume from',
      text: encodedJson({ v: 1, last: validPosition }),
    },
    {
      malformation: 'a position without a unit key',
      text: encodedJson({
        v: 1,
        tableId: 'goods',
        last: { unit: validPosition.unit },
      }),
    },
    {
      malformation: 'a unit whose table id is not a string',
      text: encodedJson({
        v: 1,
        tableId: 'goods',
        last: { key: validPosition.key, unit: { kind: 'field', tableId: 7 } },
      }),
    },
    {
      malformation: 'a row bound without its inclusive flag',
      text: encodedJson({ v: 1, tableId: 'goods', rows: { rowId: 'r1' } }),
    },
  ])('refuses $malformation', ({ text }) => {
    expect(() => decodeListingCursor(text)).toThrow(ListingValidationError);
  });
});

function encodedJson(payload: unknown): string {
  return encoded(JSON.stringify(payload));
}

function encoded(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}
