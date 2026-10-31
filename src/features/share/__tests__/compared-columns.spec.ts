import { Prisma } from 'src/__generated__/client';
import {
  COMPARED_ROW_COLUMNS,
  COMPARED_TABLE_COLUMNS,
  NOT_COMPARED_ROW_COLUMNS,
  NOT_COMPARED_TABLE_COLUMNS,
  ROW_COLUMNS_COMPARED_THROUGH,
} from 'src/features/share/compared-columns';

describe('compared columns', () => {
  it.each([
    {
      model: 'Row',
      fields: Object.values(Prisma.RowScalarFieldEnum),
      classified: [
        ...COMPARED_ROW_COLUMNS,
        ...Object.keys(ROW_COLUMNS_COMPARED_THROUGH),
        ...NOT_COMPARED_ROW_COLUMNS,
      ],
    },
    {
      model: 'Table',
      fields: Object.values(Prisma.TableScalarFieldEnum),
      classified: [...COMPARED_TABLE_COLUMNS, ...NOT_COMPARED_TABLE_COLUMNS],
    },
  ])(
    'classifies every scalar field of the $model model exactly once as compared or not compared',
    ({ fields, classified }) => {
      expect(sorted(classified)).toEqual(sorted(fields));
    },
  );
});

function sorted(fields: readonly string[]): string[] {
  return [...fields].sort((left, right) => left.localeCompare(right));
}
