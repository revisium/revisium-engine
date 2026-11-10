import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type {
  DraftRowChangesFilters,
  DraftRowItem,
} from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import type { DraftTableItem } from 'src/features/partial-changes/queries/impl/get-draft-table-changes.query';
import type { UnitRef } from 'src/features/partial-changes/selection/unit-refs';
import {
  ChangeType,
  type RowChange,
} from 'src/features/revision-changes/types';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { addressedUnitOfListed } from '../../__tests__/support/change-listing';
import type { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  rowItemsOf,
  tableItemsOf,
  unitsReachableFrom,
} from '../../__tests__/support/draft-reading';
import {
  givenRandomDraft,
  RANDOM_DRAFT_SEED_TIMEOUT_MS,
  RANDOM_DRAFT_SEEDS,
} from '../../__tests__/support/random-draft';
import { UnitKindCoverage } from '../../__tests__/support/unit-kind-coverage';

const PAGE_SIZES = [1, 2, 7];
const ALL_ROWS = 5_000;
const SEARCHED_ROWS = 5;
const SMALL_PAGE = 2;

interface RowChangeView {
  readonly key: string;
  readonly fields: readonly (readonly [string, string, unknown, unknown])[];
}

describe('Draft row reads over random Drafts', () => {
  let kit: PartialChangesTestKit;
  const coverage = new UnitKindCoverage();

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
    'reaches exactly the listed units from the table, row and summary reads, a field or column unit among the units of its row (DR-01, DR-02, seed %i)',
    async (seed) => {
      const draft = await givenRandomDraft(kit, seed);
      const listed = await draft.listEveryUnit();
      coverage.record(listed);

      const rows = await readEveryRow(draft);
      const reachable = unitsReachableFrom({
        tables: await readEveryTable(draft),
        rows,
        summary: await draft.readDraftChangesSummary(),
      });

      expect(distinctUnitsOf(reachable)).toEqual(distinctUnitsOf(listed));
      expect(rows.flatMap(fieldUnitsOutsideTheirRow)).toEqual([]);
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  it('reaches every unit kind across its seeds', () => {
    expect(coverage.missingKinds()).toEqual([]);
  });

  it.each(RANDOM_DRAFT_SEEDS)(
    'lists every native row change with its change type and field changes, on every page size, beside rows that differ only in a row column (DR-03, DR-15, seed %i)',
    async (seed) => {
      const draft = await givenRandomDraft(kit, seed);
      const native = await draft.readNativeRowChanges();
      const all = await readEveryRow(draft);
      const columns = new ReportedColumns(await readEveryTable(draft));

      for (const first of PAGE_SIZES) {
        expect(
          rowItemsOf(await draft.readEveryDraftRowPage({ first })),
        ).toEqual(all);
      }

      expect(nativeViewsOf(all, columns).sort(byKey)).toEqual(
        native.map(viewOfNativeChange).sort(byKey),
      );
      expect(
        all.filter((item) => !isNativeChange(item, native, columns)),
      ).toEqual(all.filter((item) => columns.differsOnlyInThem(item)));
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  it.each(RANDOM_DRAFT_SEEDS)(
    'counts in the table data of each table the rows the row read selects, and in the summary their sum (DR-05, seed %i)',
    async (seed) => {
      const draft = await givenRandomDraft(kit, seed);
      const tables = await readEveryTable(draft);
      const rows = await readEveryRow(draft);
      const summary = await draft.readDraftChangesSummary();

      for (const table of tables) {
        expect([table.tableId, tableDataRowsOf(table)]).toEqual([
          table.tableId,
          rowsWithUnitsOf(table, rows),
        ]);
      }

      expect(summary.rowsWithUnits).toBe(
        tables.reduce((sum, table) => sum + tableDataRowsOf(table), 0),
      );
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  it.each(RANDOM_DRAFT_SEEDS)(
    'covers in a preview that selects the table data of a table the rows its table data counts, apart from computed-only rows, all applied (DR-05, AS-88, seed %i)',
    async (seed) => {
      const draft = await givenRandomDraft(kit, seed);
      const rows = await readEveryRow(draft);
      const tables = (await readEveryTable(draft)).filter(
        (table) => selectableRowsOf(table, rows) > 0,
      );

      for (const table of tables) {
        const preview = await draft.previewChanges({
          operation: 'commit',
          selection: { tableData: [table.tableId] },
        });
        const covered = preview.coverage.find(
          ({ tableId, side }) => tableId === table.tableId && !side,
        );

        expect([table.tableId, covered]).toEqual([
          table.tableId,
          expect.objectContaining({
            rows: selectableRowsOf(table, rows),
            appliedRows: selectableRowsOf(table, rows),
            partlyAppliedRows: 0,
          }),
        ]);
      }
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  it.each(RANDOM_DRAFT_SEEDS)(
    'lists under each row filter exactly the unfiltered items it matches, with their units and links, on every page size (DR-15, DR-16, seed %i)',
    async (seed) => {
      const draft = await givenRandomDraft(kit, seed);
      const all = await readEveryRow(draft);
      const tables = await readEveryTable(draft);

      for (const filters of rowFiltersOf(tables, all)) {
        const filtered = await readEveryRow(draft, filters);

        expect([filters, filtered]).toEqual([
          filters,
          all.filter((item) => matchesRowFilters(item, filters, tables)),
        ]);

        for (const first of pageSizesOf(filters)) {
          expect([
            filters,
            first,
            rowItemsOf(await draft.readEveryDraftRowPage({ first, filters })),
          ]).toEqual([filters, first, filtered]);
        }
      }
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  it.each(RANDOM_DRAFT_SEEDS)(
    'counts in the summary the rows that the row filter of each change type lists (DR-06, seed %i)',
    async (seed) => {
      const draft = await givenRandomDraft(kit, seed);
      const { rowsSummary } = await draft.readDraftChangesSummary();
      const countOf = async (changeType: ChangeType) =>
        (await readEveryRow(draft, { changeTypes: [changeType] })).length;

      expect(rowsSummary).toEqual({
        total: (await readEveryRow(draft)).length,
        added: await countOf(ChangeType.Added),
        removed: await countOf(ChangeType.Removed),
        renamed: await countOf(ChangeType.Renamed),
        modified: await countOf(ChangeType.Modified),
      });
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  async function readEveryRow(
    draft: ChangesScenario,
    filters?: DraftRowChangesFilters,
  ): Promise<DraftRowItem[]> {
    return rowItemsOf([
      await draft.readDraftRowChanges({ first: ALL_ROWS, filters }),
    ]);
  }

  async function readEveryTable(
    draft: ChangesScenario,
  ): Promise<DraftTableItem[]> {
    return tableItemsOf([await draft.readDraftTableChanges({ first: 5_000 })]);
  }
});

// Every change type, none, every id a table item shows or names as previous, searches by a whole Draft id in another
// case, by part of one and by a Head id across the read, and two filters together.
function rowFiltersOf(
  tables: readonly DraftTableItem[],
  rows: readonly DraftRowItem[],
): DraftRowChangesFilters[] {
  const tableIds = new Set(tables.flatMap(tableIdsShownBy));
  const searches = new Set([
    '_',
    '1',
    ...sampleOf(rows).flatMap(({ rowId, previousRowId }) =>
      [rowId.toUpperCase(), rowId.slice(1, 3), previousRowId].filter(isDefined),
    ),
  ]);
  const [firstSearch] = searches;
  const [firstTableId] = tableIds;

  return [
    ...Object.values(ChangeType).map((changeType) => ({
      changeTypes: [changeType],
    })),
    { changeTypes: [] },
    ...[...tableIds].map((tableId) => ({ tableId })),
    ...[...searches].map((search) => ({ search })),
    { changeTypes: [ChangeType.Modified], search: '1' },
    { tableId: firstTableId, search: firstSearch },
  ];
}

function tableIdsShownBy({
  tableId,
  previousTableId,
}: DraftTableItem): string[] {
  return [tableId, previousTableId].filter(isDefined);
}

// Up to SEARCHED_ROWS rows spread over the read.
function sampleOf(rows: readonly DraftRowItem[]): DraftRowItem[] {
  const step = Math.max(Math.floor(rows.length / SEARCHED_ROWS), 1);

  return rows.filter((_, index) => index % step === 0).slice(0, SEARCHED_ROWS);
}

// A change type filter pages at every page size; the other filters at the smallest that splits most pages.
function pageSizesOf(filters: DraftRowChangesFilters): readonly number[] {
  if (filters.changeTypes?.length === 1) {
    return PAGE_SIZES;
  }

  return [SMALL_PAGE];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

// The row filters of SPEC §7, over the items of an unfiltered read.
function matchesRowFilters(
  { tableId, previousTableId, rowId, previousRowId, changeType }: DraftRowItem,
  filters: DraftRowChangesFilters,
  tables: readonly DraftTableItem[],
): boolean {
  if (
    filters.tableId &&
    !isOfTable({ tableId, previousTableId }, filters.tableId, tables)
  ) {
    return false;
  }

  if (filters.changeTypes) {
    const types = filters.changeTypes;
    const matches =
      types.includes(changeType) ||
      (changeType === ChangeType.RenamedAndModified &&
        (types.includes(ChangeType.Renamed) ||
          types.includes(ChangeType.Modified)));

    if (!matches) {
      return false;
    }
  }

  if (filters.search) {
    const term = filters.search.toLowerCase();

    return [rowId, previousRowId].some((id) =>
      id?.toLowerCase().includes(term),
    );
  }

  return true;
}

// The rows of the table items that show the id; only when none does, those of the renamed table it was in Head.
function isOfTable(
  {
    tableId,
    previousTableId,
  }: Pick<DraftRowItem, 'tableId' | 'previousTableId'>,
  id: string,
  tables: readonly DraftTableItem[],
): boolean {
  if (tables.some((table) => table.tableId === id)) {
    return tableId === id;
  }

  return previousTableId === id;
}

function distinctUnitsOf(units: readonly UnitRef[]): string[] {
  const keys = units.map((unit) =>
    JSON.stringify(withoutUndefined(addressedUnitOfListed(unit))),
  );

  return [...new Set(keys)].sort(compareCodePoints);
}

function withoutUndefined(unit: object): object {
  return Object.fromEntries(
    Object.entries(unit).filter(([, value]) => value !== undefined),
  );
}

// The native diff compares id and data only; the reads also compare publishedAt, meta, and schemaHash in a table whose
// structure is unchanged (SPEC §3).
class ReportedColumns {
  private readonly changedStructures: ReadonlySet<string>;

  constructor(tables: readonly DraftTableItem[]) {
    this.changedStructures = new Set(
      tables.flatMap(({ tableId, changeType, selection }) =>
        changeType !== ChangeType.Added &&
        changeType !== ChangeType.Removed &&
        selection.state === 'selectable' &&
        selection.structure
          ? [tableId]
          : [],
      ),
    );
  }

  public differsOnlyInThem(item: DraftRowItem): boolean {
    return (
      item.changeType === ChangeType.Modified &&
      item.fields.length === 0 &&
      this.differsIn(item)
    );
  }

  public nativeChangeTypeOf(item: DraftRowItem): ChangeType {
    if (
      item.changeType === ChangeType.RenamedAndModified &&
      item.fields.length === 0 &&
      this.differsIn(item)
    ) {
      return ChangeType.Renamed;
    }

    return item.changeType;
  }

  private differsIn({ tableId, columns }: DraftRowItem): boolean {
    return columns.some(
      ({ column }) =>
        column !== 'schemaHash' || !this.changedStructures.has(tableId),
    );
  }
}

function nativeViewsOf(
  items: readonly DraftRowItem[],
  columns: ReportedColumns,
): RowChangeView[] {
  return items
    .filter((item) => !columns.differsOnlyInThem(item))
    .map((item) => ({
      key: keyOf(item.tableId, item.rowId, columns.nativeChangeTypeOf(item)),
      fields: item.fields.map(({ path, changeType, oldValue, newValue }) => [
        path,
        changeType,
        oldValue,
        newValue,
      ]),
    }));
}

function isNativeChange(
  item: DraftRowItem,
  native: readonly RowChange[],
  columns: ReportedColumns,
): boolean {
  return native.some(
    (change) =>
      keyOf(
        tableIdOfNative(change),
        rowIdOfNative(change),
        change.changeType,
      ) === keyOf(item.tableId, item.rowId, columns.nativeChangeTypeOf(item)),
  );
}

// A field or column that selects a unit selects one of the units its row lists.
function fieldUnitsOutsideTheirRow({
  tableId,
  rowId,
  selection,
  fields,
  columns,
}: DraftRowItem): string[] {
  const rowUnits = new Set(selection.units.map((unit) => JSON.stringify(unit)));

  return [...fields, ...columns].flatMap((change) =>
    change.selection.state === 'unit' &&
    !rowUnits.has(JSON.stringify(change.selection.unit))
      ? [`${tableId}/${rowId}: ${JSON.stringify(change.selection.unit)}`]
      : [],
  );
}

function viewOfNativeChange(change: RowChange): RowChangeView {
  return {
    key: keyOf(
      tableIdOfNative(change),
      rowIdOfNative(change),
      change.changeType,
    ),
    fields: change.fieldChanges.map(
      ({ fieldPath, changeType, oldValue, newValue }) => [
        fieldPath === '' ? '' : `/${fieldPath.replaceAll('.', '/')}`,
        changeType,
        oldValue ?? null,
        newValue ?? null,
      ],
    ),
  };
}

function tableIdOfNative({ table, fromTable }: RowChange): string {
  return table?.id ?? fromTable?.id ?? '';
}

function rowIdOfNative({ row, fromRow }: RowChange): string {
  return row?.id ?? fromRow?.id ?? '';
}

function keyOf(tableId: string, rowId: string, changeType: string): string {
  return `${tableId}/${rowId} ${changeType}`;
}

function byKey(left: RowChangeView, right: RowChangeView): number {
  return compareCodePoints(left.key, right.key);
}

function tableDataRowsOf({ selection }: DraftTableItem): number {
  if (selection.state !== 'selectable') {
    return 0;
  }

  return selection.tableData?.rows ?? 0;
}

// Selectable rows count by their row selector; a row whose only stored difference is computed counts too (§4).
function rowsWithUnitsOf(
  table: DraftTableItem,
  rows: readonly DraftRowItem[],
): number {
  const computed = rowsOfTable(table, rows).filter(
    ({ selection }) => selection.state === 'computed',
  );

  return selectableRowsOf(table, rows) + computed.length;
}

// The rows with units, each counted by its row selector: what a plan covers (partial-changes-v1 §5.1).
function selectableRowsOf(
  table: DraftTableItem,
  rows: readonly DraftRowItem[],
): number {
  const selectors = new Set(
    rowsOfTable(table, rows).flatMap(({ selection }) =>
      selection.state === 'selectable' ? [JSON.stringify(selection.row)] : [],
    ),
  );

  return selectors.size;
}

function rowsOfTable(
  table: DraftTableItem,
  rows: readonly DraftRowItem[],
): DraftRowItem[] {
  if (
    table.changeType === ChangeType.Added ||
    table.changeType === ChangeType.Removed
  ) {
    return [];
  }

  return rows.filter(({ tableId }) => tableId === table.tableId);
}
