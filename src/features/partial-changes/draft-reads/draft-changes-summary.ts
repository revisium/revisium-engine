import { Injectable } from '@nestjs/common';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { UnitKind } from 'src/features/partial-changes/catalogue/unit';
import type {
  DraftChangesSummaryRequest,
  TableFilters,
} from 'src/features/partial-changes/draft-reads/draft-read-request';
import { tableSelectionOf } from 'src/features/partial-changes/draft-reads/draft-table-items';
import {
  type DraftTables,
  DraftTablesReader,
} from 'src/features/partial-changes/draft-reads/draft-tables';
import type { ReportedRowCounts } from 'src/features/partial-changes/draft-reads/reported-row-counts-reader';
import { matchesTableFilters } from 'src/features/partial-changes/draft-reads/table-filters';
import type {
  ChangedSharedSchema,
  DraftChangesSummary,
  TransientTable,
  ViewsOnlyTable,
} from 'src/features/partial-changes/queries/impl/get-draft-changes-summary.query';
import { unitRefOf } from 'src/features/partial-changes/selection/unit-refs';
import type { RevisionRows } from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  ChangeType,
  type RevisionChangeSummary,
} from 'src/features/revision-changes/types';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

type SummaryCounts = Pick<
  DraftChangesSummary,
  'tablesSummary' | 'rowsSummary' | 'rowsWithUnits'
>;

type SummaryItems = Pick<
  DraftChangesSummary,
  'sharedSchemas' | 'transientTables' | 'viewsOnlyTables'
>;

interface ListedTableCounts {
  readonly changeType: ChangeType;
  readonly replacedTableId?: string;
  readonly rows: ReportedRowCounts;
  readonly rowsWithUnits: number;
}

@Injectable()
export class DraftChangesSummaryReader {
  constructor(private readonly tablesReader: DraftTablesReader) {}

  public async read({
    branch,
    filters,
  }: DraftChangesSummaryRequest): Promise<DraftChangesSummary> {
    const tables = await this.tablesReader.read(branch);
    const items = summaryItemsOf(tables);

    return {
      ...tables.readState,
      ...countsOf(await listedTableCountsOf(tables)),
      ...itemsMatching(items, filters),
      sharedSchemasCount: items.sharedSchemas.length,
      transientTablesCount: items.transientTables.length,
      viewsOnlyTablesCount: items.viewsOnlyTables.length,
    };
  }
}

async function listedTableCountsOf(
  tables: DraftTables,
): Promise<ListedTableCounts[]> {
  const counts: ListedTableCounts[] = [];

  for (const table of tables.listed) {
    const rows = await tables.rowCountsOf(table);
    const selection = tableSelectionOf(table, rows, tables.catalogue);

    counts.push({
      changeType: await tables.changeTypeOf(table),
      replacedTableId: tables.catalogue.isReplaced(table.pair)
        ? table.position.tableId
        : undefined,
      rows,
      rowsWithUnits:
        selection.state === 'selectable' ? (selection.tableData?.rows ?? 0) : 0,
    });
  }

  return counts;
}

function countsOf(tables: readonly ListedTableCounts[]): SummaryCounts {
  const changeTypes = tables.map(({ changeType }) => changeType);
  const replacedTableIds = new Set(
    tables.flatMap(({ replacedTableId }) =>
      replacedTableId === undefined ? [] : [replacedTableId],
    ),
  );

  return {
    tablesSummary: {
      ...tablesSummaryOf(changeTypes),
      replaced: replacedTableIds.size,
    },
    rowsSummary: rowsSummaryOf(tables.map(({ rows }) => rows)),
    rowsWithUnits: sumOf(tables.map(({ rowsWithUnits }) => rowsWithUnits)),
  };
}

function tablesSummaryOf(
  changeTypes: readonly ChangeType[],
): RevisionChangeSummary {
  const countOf = (...counted: ChangeType[]) =>
    changeTypes.filter((changeType) => counted.includes(changeType)).length;

  return {
    total: changeTypes.length,
    added: countOf(ChangeType.Added),
    modified: countOf(ChangeType.Modified, ChangeType.RenamedAndModified),
    removed: countOf(ChangeType.Removed),
    renamed: countOf(ChangeType.Renamed, ChangeType.RenamedAndModified),
  };
}

function rowsSummaryOf(
  counts: readonly ReportedRowCounts[],
): RevisionChangeSummary {
  const sumOfCount = (count: keyof RevisionChangeSummary) =>
    sumOf(counts.map((tableCounts) => tableCounts[count]));

  return {
    total: sumOfCount('total'),
    added: sumOfCount('added'),
    modified: sumOfCount('modified'),
    removed: sumOfCount('removed'),
    renamed: sumOfCount('renamed'),
  };
}

function summaryItemsOf(tables: DraftTables): SummaryItems {
  return {
    sharedSchemas: sharedSchemasOf(
      tables,
      tables.compared.snapshot.systemRows.sharedSchemas,
    ),
    transientTables: transientTablesOf(tables),
    viewsOnlyTables: viewsOnlyTablesOf(tables),
  };
}

function itemsMatching(
  { sharedSchemas, transientTables, viewsOnlyTables }: SummaryItems,
  filters: TableFilters,
): SummaryItems {
  return {
    sharedSchemas: sharedSchemas.filter(({ sharedSchemaId, changeType }) =>
      matchesTableFilters(filters, changeType, [sharedSchemaId]),
    ),
    transientTables: transientTables.filter(({ tableId, changeType }) =>
      matchesTableFilters(filters, changeType, [tableId]),
    ),
    viewsOnlyTables: viewsOnlyTables.filter(({ tableId, changeType }) =>
      matchesTableFilters(filters, changeType, [tableId]),
    ),
  };
}

function sharedSchemasOf(
  tables: DraftTables,
  rows: RevisionRows,
): ChangedSharedSchema[] {
  return unitsOfKind(tables, 'sharedSchema').map((unit) => ({
    sharedSchemaId: unit.unit.tableId,
    changeType: sharedSchemaChangeTypeOf(unit, rows),
    unit: unitRefOf(unit),
  }));
}

// A table created and removed inside the Draft has no table identity on either side.
function transientTablesOf(tables: DraftTables): TransientTable[] {
  return unitsOfKind(tables, 'structure')
    .filter(({ tableIdentities }) => tableIdentities.length === 0)
    .map((unit) => ({
      tableId: unit.unit.tableId,
      changeType: ChangeType.Added,
      structure: tables.catalogue.describe(unit),
    }));
}

function viewsOnlyTablesOf(tables: DraftTables): ViewsOnlyTable[] {
  const listed = new Set(tables.listed.map(({ pair }) => pair.identity));

  return unitsOfKind(tables, 'views')
    .filter(({ tableIdentities }) =>
      tableIdentities.every((identity) => !listed.has(identity)),
    )
    .map((unit) => ({
      tableId: unit.unit.tableId,
      changeType: ChangeType.Modified,
      views: unitRefOf(unit),
    }));
}

function unitsOfKind(tables: DraftTables, kind: UnitKind): CatalogueUnit[] {
  return tables.catalogue.units
    .filter(({ unit }) => unit.kind === kind)
    .sort((left, right) =>
      compareCodePoints(left.unit.tableId, right.unit.tableId),
    );
}

function sharedSchemaChangeTypeOf(
  { systemRows }: CatalogueUnit,
  { head, draft }: RevisionRows,
): ChangeType {
  const headVersions = new Set(head.map(({ versionId }) => versionId));
  const draftVersions = new Set(draft.map(({ versionId }) => versionId));

  if (!systemRows.some(({ versionId }) => headVersions.has(versionId))) {
    return ChangeType.Added;
  }

  if (!systemRows.some(({ versionId }) => draftVersions.has(versionId))) {
    return ChangeType.Removed;
  }

  return ChangeType.Modified;
}

function sumOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}
