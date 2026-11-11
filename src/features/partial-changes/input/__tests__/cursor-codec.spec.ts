import {
  cursorPartsOf,
  encodeCursor,
} from 'src/features/partial-changes/input/cursor-codec';

const ROW_PARTS: ReadonlySet<string> = new Set(['tableId', 'rowId', 'bound']);

describe('cursor codec', () => {
  it('decodes the parts it encoded for the same kind', () => {
    const parts = {
      tableId: 'notes',
      rowId: 'n/1',
      bound: { inclusive: true },
    };

    expect(
      cursorPartsOf(encodeCursor('rows', parts), 'rows', ROW_PARTS),
    ).toMatchObject(parts);
  });

  it('encodes an opaque URL-safe text', () => {
    expect(encodeCursor('rows', { tableId: 'é 😀/x' })).toMatch(/^[\w-]+$/);
  });

  it('refuses a cursor of another kind', () => {
    const cursor = encodeCursor('tables', { tableId: 'notes' });

    expect(cursorPartsOf(cursor, 'rows', ROW_PARTS)).toBeUndefined();
  });

  it.each([
    { malformation: 'an empty text', text: '' },
    { malformation: 'a text that is not base64url', text: 'not a cursor' },
    { malformation: 'a text that is not JSON', text: encoded('{"v":') },
    { malformation: 'an offset', text: '10' },
    { malformation: 'a JSON array', text: encodedJson([2, 'rows']) },
    {
      malformation: 'another version',
      text: encodedJson({ v: 1, kind: 'rows', tableId: 'notes' }),
    },
    {
      malformation: 'a payload without a kind',
      text: encodedJson({ v: 2, tableId: 'notes' }),
    },
    {
      malformation: 'a part the kind does not name',
      text: encodeCursor('rows', { tableId: 'notes', headOnly: false }),
    },
  ])('refuses $malformation', ({ text }) => {
    expect(cursorPartsOf(text, 'rows', ROW_PARTS)).toBeUndefined();
  });

  it.each([
    { part: 'a top-level text', parts: { tableId: 'no\u0000tes' } },
    {
      part: 'a nested text',
      parts: { tableId: 'notes', bound: { rowId: 'n\u00001' } },
    },
    {
      part: 'a text in a list',
      parts: { tableId: 'notes', bound: ['n\u00001'] },
    },
  ])('refuses the NUL character in $part', ({ parts }) => {
    expect(
      cursorPartsOf(encodeCursor('rows', parts), 'rows', ROW_PARTS),
    ).toBeUndefined();
  });
});

function encodedJson(payload: unknown): string {
  return encoded(JSON.stringify(payload));
}

function encoded(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}
