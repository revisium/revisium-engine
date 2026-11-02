export interface ForbiddenNullField {
  readonly field: string;
  readonly selection: unknown;
}

export const FORBIDDEN_NULL_FIELDS: readonly ForbiddenNullField[] = [
  {
    field: 'an unknown field',
    selection: { all: true, rowz: null },
  },
  {
    field: 'all inside exclude',
    selection: { all: true, exclude: { all: null } },
  },
  {
    field: 'exclude inside exclude',
    selection: { all: true, exclude: { exclude: null } },
  },
  {
    field: 'path of a rows selector',
    selection: { rows: [{ tableId: 'products', rowId: 'p1', path: null }] },
  },
];
