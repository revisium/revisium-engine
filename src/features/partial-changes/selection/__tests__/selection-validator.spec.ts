import {
  SelectionValidationError,
  validateComment,
  validateOperation,
  validateRequiredAdditionsAcceptance,
  validateSelection,
} from 'src/features/partial-changes/selection/selection-validator';

const PRODUCTS = 'products';

describe('SelectionValidator', () => {
  it('accepts a well-formed selection that uses every field', () => {
    const selection = {
      all: false,
      structures: [
        { tableId: PRODUCTS },
        { tableId: 'categories', side: 'head' },
      ],
      tableData: [PRODUCTS],
      views: [PRODUCTS],
      sharedSchemas: ['address'],
      rows: [{ tableId: PRODUCTS, rowId: 'p1', side: 'head' }],
      rowRenames: [{ tableId: PRODUCTS, rowId: 'p2' }],
      rowColumns: [{ tableId: PRODUCTS, rowId: 'p3' }],
      fields: [
        { tableId: PRODUCTS, rowId: 'p1', path: '' },
        { tableId: PRODUCTS, rowId: 'p1', path: '/size/width' },
        { tableId: PRODUCTS, rowId: 'p1', path: '/a~1b/~0c' },
      ],
      exclude: { rows: [{ tableId: PRODUCTS, rowId: 'p4' }] },
    };

    expect(validateSelection(selection)).toEqual(selection);
  });

  it('returns the selection without its optional fields given as null', () => {
    const selection = {
      all: null,
      structures: [{ tableId: PRODUCTS, side: null }],
      rows: null,
      rowRenames: [{ tableId: PRODUCTS, rowId: 'p2', side: null }],
      exclude: { tableData: null, rowColumns: [] },
    };

    expect(validateSelection(selection)).toStrictEqual({
      structures: [{ tableId: PRODUCTS }],
      rowRenames: [{ tableId: PRODUCTS, rowId: 'p2' }],
      exclude: { rowColumns: [] },
    });
  });

  it('reads the item lists of an exclude through its getters', () => {
    const exclude = new (class {
      get rows() {
        return [{ tableId: PRODUCTS, rowId: 'p4' }];
      }
    })();

    expect(validateSelection({ all: true, exclude })).toStrictEqual({
      all: true,
      exclude: { rows: [{ tableId: PRODUCTS, rowId: 'p4' }] },
    });
  });

  it('checks every indexed item of a list whose iterator yields nothing', () => {
    const rows = Object.defineProperty([null], Symbol.iterator, {
      value: function* () {},
    });

    expect(() => validateSelection({ all: true, exclude: { rows } })).toThrow(
      'selection.exclude.rows[0] must be an object',
    );
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
      input: { structures: PRODUCTS },
      message: 'selection.structures must be an array',
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
      input: { rowRenames: [{ tableId: PRODUCTS }] },
      message: 'selection.rowRenames[0].rowId must be a non-empty string',
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
      input: { structures: [{ tableId: PRODUCTS, side: 'draft' }] },
      message: "selection.structures[0].side must be 'head'",
    },
    {
      error: 'a bare table id in structures',
      input: { structures: [PRODUCTS] },
      message: 'selection.structures[0] must be an object',
    },
    {
      error: 'the field tables of version 1',
      input: { tables: [{ tableId: PRODUCTS }] },
      message: 'selection.tables is not allowed',
    },
    {
      error: 'the field renames of version 1',
      input: { renames: [{ tableId: PRODUCTS, rowId: 'p2' }] },
      message: 'selection.renames is not allowed',
    },
    {
      error: 'the field tables of version 1 inside exclude',
      input: { all: true, exclude: { tables: [{ tableId: PRODUCTS }] } },
      message: 'selection.exclude.tables is not allowed',
    },
    {
      error: 'the field renames of version 1 inside exclude',
      input: {
        all: true,
        exclude: { renames: [{ tableId: PRODUCTS, rowId: 'p2' }] },
      },
      message: 'selection.exclude.renames is not allowed',
    },
    {
      error: 'a bare table id in structures inside exclude',
      input: { all: true, exclude: { structures: [PRODUCTS] } },
      message: 'selection.exclude.structures[0] must be an object',
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
    {
      error: 'an unknown field given as null',
      input: { all: true, rowz: null },
      message: 'selection.rowz is not allowed',
    },
    {
      error: 'all inside exclude given as null',
      input: { all: true, exclude: { all: null } },
      message: 'selection.exclude.all is not allowed',
    },
    {
      error: 'a field a selector does not have given as null',
      input: { rows: [{ tableId: PRODUCTS, rowId: 'p1', path: null }] },
      message: 'selection.rows[0].path is not allowed',
    },
    {
      error: 'a required id given as null',
      input: { fields: [{ tableId: PRODUCTS, rowId: null, path: '/a' }] },
      message: 'selection.fields[0].rowId must be a non-empty string',
    },
    {
      error: 'a null entry of an item list',
      input: { tableData: [null] },
      message: 'selection.tableData[0] must be a non-empty string',
    },
  ])('refuses $error with a validation error', ({ input, message }) => {
    expectValidationError(() => validateSelection(input), message);
  });

  it('refuses an operation other than commit and revert', () => {
    expectValidationError(
      () => validateOperation('publish'),
      "operation must be 'commit' or 'revert'",
    );
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

  it.each([
    {
      error: 'includeRequired given as a string',
      acceptance: { includeRequired: 'false' },
      message: 'includeRequired must be a boolean',
    },
    {
      error: 'an empty expected',
      acceptance: { includeRequired: true, expected: '' },
      message: 'expected must be a non-empty string',
    },
    {
      error: 'expected given as a number',
      acceptance: { expected: 1 },
      message: 'expected must be a non-empty string',
    },
  ])(
    'refuses required additions acceptance with $error',
    ({ acceptance, message }) => {
      expectValidationError(
        () => validateRequiredAdditionsAcceptance(acceptance),
        message,
      );
    },
  );

  it('refuses a comment that is not a string', () => {
    expectValidationError(() => validateComment(1), 'comment must be a string');
  });
});

function expectValidationError(validate: () => unknown, message: string): void {
  expect(validate).toThrow(SelectionValidationError);
  expect(validate).toThrow(new SelectionValidationError(message));
}
