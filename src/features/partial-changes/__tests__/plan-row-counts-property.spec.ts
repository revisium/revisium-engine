import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { RowKindCounts } from 'src/features/partial-changes/planning/plan-coverage';
import type { DraftRowItem } from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import type { DraftTableItem } from 'src/features/partial-changes/queries/impl/get-draft-table-changes.query';
import type { UnitRef } from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesScenario } from './support/changes-scenario';
import { rowItemsOf, tableItemsOf } from './support/draft-reading';
import {
  givenRandomDraft,
  RANDOM_DRAFT_SEED_TIMEOUT_MS,
  RANDOM_DRAFT_SEEDS,
} from './support/random-draft';

const ALL_ITEMS = 5_000;

const NO_ROWS: RowKindCounts = {
  total: 0,
  added: 0,
  modified: 0,
  removed: 0,
  renamed: 0,
  replaced: 0,
  partlyApplied: 0,
};

// partial-changes-v1 §5.1: a plan counts a row by the kinds of its applied units, as the Draft reads show the row.
describe('the row counts of a plan over random Drafts (AS-101)', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(RANDOM_DRAFT_SEEDS)(
    'counts for the table data of a table the rows its table data counts, each added, removed, replaced and renamed row as the Draft reads count it, and as modified the rows whose values or columns it applies (seed %i)',
    async (seed) => {
      const draft = await givenRandomDraft(kit, seed);
      const rows = await readEveryRow(draft);
      const tables = (await readEveryTable(draft)).filter(
        (table) => tableDataRowsOf(table) > 0,
      );

      for (const table of tables) {
        const preview = await draft.previewChanges({
          operation: 'commit',
          selection: { tableData: [table.tableId] },
        });
        const covered = preview.coverage.find(
          ({ tableId, side }) => tableId === table.tableId && !side,
        );
        const { added, removed, replaced, renamed, modified } =
          table.rowsSummary;
        const rowsOfTable = rows.filter(
          ({ tableId }) => tableId === table.tableId,
        );

        expect([table.tableId, covered?.rowCounts]).toEqual([
          table.tableId,
          {
            selected: {
              ...NO_ROWS,
              total: tableDataRowsOf(table),
              added,
              removed,
              replaced,
              renamed,
              modified: rowsWithAppliedValuesOf(rowsOfTable),
            },
            required: NO_ROWS,
          },
        ]);
        expect(covered?.rowCounts.selected.modified).toBeLessThanOrEqual(
          modified,
        );
      }
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  async function readEveryRow(draft: ChangesScenario): Promise<DraftRowItem[]> {
    return rowItemsOf([await draft.readDraftRowChanges({ first: ALL_ITEMS })]);
  }

  async function readEveryTable(
    draft: ChangesScenario,
  ): Promise<DraftTableItem[]> {
    return tableItemsOf([
      await draft.readDraftTableChanges({ first: ALL_ITEMS }),
    ]);
  }
});

function tableDataRowsOf({ selection }: DraftTableItem): number {
  if (selection.state !== 'selectable') {
    return 0;
  }

  return selection.tableData?.rows ?? 0;
}

// The rows whose own units change a value or a row column that the reads show: a schemaHash alone is not shown.
function rowsWithAppliedValuesOf(rows: readonly DraftRowItem[]): number {
  const selectors = new Set(
    rows.flatMap(({ selection }) =>
      selection.state === 'selectable' && selection.units.some(changesAValue)
        ? [JSON.stringify(selection.row)]
        : [],
    ),
  );

  return selectors.size;
}

function changesAValue(unit: UnitRef): boolean {
  if (unit.kind === 'field') {
    return true;
  }

  return (
    unit.kind === 'rowColumns' &&
    unit.columns.some((column) => column !== 'schemaHash')
  );
}
