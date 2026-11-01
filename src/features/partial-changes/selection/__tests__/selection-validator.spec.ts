import {
  SelectionValidationError,
  validateRequiredAdditionsAcceptance,
  validateSelection,
} from 'src/features/partial-changes/selection/selection-validator';

const PRODUCTS = 'products';

describe('SelectionValidator', () => {
  it('accepts a well-formed selection that uses every field', () => {
    const selection = {
      all: false,
      tables: [PRODUCTS, { tableId: 'categories', side: 'head' }],
      tableData: [PRODUCTS],
      views: [PRODUCTS],
      sharedSchemas: ['address'],
      rows: [{ tableId: PRODUCTS, rowId: 'p1', side: 'head' }],
      renames: [{ tableId: PRODUCTS, rowId: 'p2' }],
      rowColumns: [{ tableId: PRODUCTS, rowId: 'p3' }],
      fields: [
        { tableId: PRODUCTS, rowId: 'p1', path: '' },
        { tableId: PRODUCTS, rowId: 'p1', path: '/size/width' },
        { tableId: PRODUCTS, rowId: 'p1', path: '/a~1b/~0c' },
      ],
      exclude: { rows: [{ tableId: PRODUCTS, rowId: 'p4' }] },
    };

    expect(validateSelection(selection)).toBe(selection);
  });

  it.each([
    {
      error: 'a selection that is not an object',
      input: [PRODUCTS],
      message: 'selection must be an object',
    },
    {
      error: 'an unknown field',
      input: { rowz: [] },
      message: 'selection.rowz is not allowed',
    },
    {
      error: 'an unknown field of a selector',
      input: { rows: [{ tableId: PRODUCTS, rowId: 'p1', path: '/code' }] },
      message: 'selection.rows[0].path is not allowed',
    },
    {
      error: 'a field of a wrong type',
      input: { tables: PRODUCTS },
      message: 'selection.tables must be an array',
    },
    {
      error: 'all of a wrong type',
      input: { all: 'yes' },
      message: 'selection.all must be a boolean',
    },
    {
      error: 'an id of a wrong type',
      input: { rows: [{ tableId: 7, rowId: 'p1' }] },
      message: 'selection.rows[0].tableId must be a non-empty string',
    },
    {
      error: 'a missing id',
      input: { renames: [{ tableId: PRODUCTS }] },
      message: 'selection.renames[0].rowId must be a non-empty string',
    },
    {
      error: 'an empty table id',
      input: { tableData: [''] },
      message: 'selection.tableData[0] must be a non-empty string',
    },
    {
      error: 'an empty row id',
      input: { rowColumns: [{ tableId: PRODUCTS, rowId: '' }] },
      message: 'selection.rowColumns[0].rowId must be a non-empty string',
    },
    {
      error: 'a path without a leading slash',
      input: { fields: [{ tableId: PRODUCTS, rowId: 'p1', path: 'code' }] },
      message: 'selection.fields[0].path must be a JSON Pointer',
    },
    {
      error: 'a path with an invalid ~ escape',
      input: { fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/a~2b' }] },
      message: 'selection.fields[0].path must be a JSON Pointer',
    },
    {
      error: 'a path that ends in ~',
      input: { fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/a~' }] },
      message: 'selection.fields[0].path must be a JSON Pointer',
    },
    {
      error: 'a path of a wrong type',
      input: { fields: [{ tableId: PRODUCTS, rowId: 'p1', path: 5 }] },
      message: 'selection.fields[0].path must be a JSON Pointer',
    },
    {
      error: 'a row side other than head',
      input: { rows: [{ tableId: PRODUCTS, rowId: 'p1', side: 'draft' }] },
      message: "selection.rows[0].side must be 'head'",
    },
    {
      error: 'a table side other than head',
      input: { tables: [{ tableId: PRODUCTS, side: 'draft' }] },
      message: "selection.tables[0].side must be 'head'",
    },
    {
      error: 'all inside exclude',
      input: { exclude: { all: true } },
      message: 'selection.exclude.all is not allowed',
    },
    {
      error: 'exclude inside exclude',
      input: { exclude: { exclude: {} } },
      message: 'selection.exclude.exclude is not allowed',
    },
    {
      error: 'a malformed selector inside exclude',
      input: {
        exclude: { fields: [{ tableId: PRODUCTS, rowId: 'p1', path: 'code' }] },
      },
      message: 'selection.exclude.fields[0].path must be a JSON Pointer',
    },
    {
      error: 'a missing entry of a sparse selector array',
      input: { rows: new Array(1) },
      message: 'selection.rows[0] must be an object',
    },
    {
      error: 'a missing entry of a sparse id array',
      input: { exclude: { tableData: new Array(1) } },
      message: 'selection.exclude.tableData[0] must be a non-empty string',
    },
  ])('refuses $error with a validation error', ({ input, message }) => {
    expectValidationError(() => validateSelection(input), message);
  });

  it('refuses to include required additions without an expected fingerprint', () => {
    expectValidationError(
      () => validateRequiredAdditionsAcceptance({ includeRequired: true }),
      'includeRequired requires expected',
    );
  });

  it.each([
    { includeRequired: true, expected: 'fingerprint' },
    { includeRequired: false },
    {},
  ])('accepts required additions acceptance %o', (acceptance) => {
    expect(() => validateRequiredAdditionsAcceptance(acceptance)).not.toThrow();
  });
});

function expectValidationError(validate: () => unknown, message: string): void {
  expect(validate).toThrow(SelectionValidationError);
  expect(validate).toThrow(new SelectionValidationError(message));
}
