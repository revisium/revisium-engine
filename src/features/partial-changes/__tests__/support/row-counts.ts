import type {
  PlanRowCounts,
  RowKindCounts,
  TableCoverage,
} from 'src/features/partial-changes/planning/plan-coverage';
import type { PlanPlace } from 'src/features/partial-changes/planning/plan-places';

export const NO_ROWS: RowKindCounts = {
  total: 0,
  added: 0,
  modified: 0,
  removed: 0,
  renamed: 0,
  replaced: 0,
  partlyApplied: 0,
};

export const NO_ROW_COUNTS: PlanRowCounts = {
  selected: NO_ROWS,
  required: NO_ROWS,
};

interface EditedTable {
  readonly tableId: string;
  // The rows of the table with units.
  readonly rows: number;
  // Whether the edited row has other edits the operation leaves.
  readonly partly: boolean;
}

interface AppliedRows {
  readonly rowCounts: PlanRowCounts;
  readonly coverage: TableCoverage[];
}

// What an operation that applies one selected value of one row of a table on both sides applies.
export function oneSelectedValueOf({
  tableId,
  rows,
  partly,
}: EditedTable): AppliedRows {
  const rowCounts: PlanRowCounts = {
    selected: {
      ...NO_ROWS,
      total: 1,
      modified: 1,
      partlyApplied: Number(partly),
    },
    required: NO_ROWS,
  };

  return {
    rowCounts,
    coverage: [
      {
        tableId,
        rows,
        appliedRows: partly ? 0 : 1,
        partlyAppliedRows: Number(partly),
        rowCounts,
      },
    ],
  };
}

// The place of a value of a row that an operation applies, edited at any time.
export function editedValuePlaceOf(tableId: string, rowId: string): PlanPlace {
  return {
    kind: 'row',
    tableId,
    rowId,
    units: ['field'],
    changedAt: expect.any(Date) as Date,
  };
}
