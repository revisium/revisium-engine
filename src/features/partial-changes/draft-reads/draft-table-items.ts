import { Injectable } from '@nestjs/common';
import type { Row } from 'src/engine-prisma-types';
import { encodeTableCursor } from 'src/features/partial-changes/draft-reads/draft-cursor';
import type {
  DraftTable,
  DraftTables,
} from 'src/features/partial-changes/draft-reads/draft-tables';
import { tableIdsOf } from 'src/features/partial-changes/draft-reads/table-ids';
import type { ReportedRowCounts } from 'src/features/partial-changes/draft-reads/reported-row-counts-reader';
import type { DraftCatalogue } from 'src/features/partial-changes/draft-reads/draft-catalogue';
import type { DraftEdge } from 'src/features/partial-changes/queries/impl/draft-reads';
import type {
  DraftTableItem,
  SelectableTableSelection,
  TableData,
  TableSelection,
} from 'src/features/partial-changes/queries/impl/get-draft-table-changes.query';
import { unitRefOf } from 'src/features/partial-changes/selection/unit-refs';
import { pendingEntriesOf } from 'src/features/partial-changes/snapshot/ledger-attribution';
import { SchemaImpactService } from 'src/features/revision-changes/services/schema-impact.service';
import { ViewsComparisonService } from 'src/features/revision-changes/services/views-comparison.service';
import type {
  RevisionChangeSummary,
  SchemaMigrationDetail,
  ViewsChangeDetail,
} from 'src/features/revision-changes/types';
import type { TableViewsData } from 'src/features/views/types';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

@Injectable()
export class DraftTableItems {
  constructor(
    private readonly schemaImpact: SchemaImpactService,
    private readonly viewsComparison: ViewsComparisonService,
  ) {}

  public async edgesOf(
    page: readonly DraftTable[],
    tables: DraftTables,
  ): Promise<DraftEdge<DraftTableItem>[]> {
    const edges: DraftEdge<DraftTableItem>[] = [];

    for (const table of page) {
      edges.push({
        cursor: encodeTableCursor(table.position),
        node: await this.itemOf(table, tables),
      });
    }

    return edges;
  }

  private async itemOf(
    table: DraftTable,
    tables: DraftTables,
  ): Promise<DraftTableItem> {
    const { pair } = table;
    const counts = await tables.rowCountsOf(table);

    return {
      ...tableIdsOf(pair),
      changeType: await tables.changeTypeOf(table),
      replaced: tables.catalogue.isReplaced(pair),
      rowsSummary: rowsSummaryOf(counts),
      schemaMigrations: this.schemaMigrationsOf(table, tables),
      viewsChanges: this.viewsChangesOf(table, tables.catalogue),
      selection: tableSelectionOf(table, counts, tables.catalogue),
    };
  }

  private schemaMigrationsOf(
    { pair }: DraftTable,
    { compared }: DraftTables,
  ): SchemaMigrationDetail[] {
    return this.schemaImpact.extractMigrationDetails(
      pendingEntriesOf(compared.ledger, pair.identity).map(
        ({ row }) => row.data,
      ),
    );
  }

  private viewsChangesOf(
    { pair }: DraftTable,
    catalogue: DraftCatalogue,
  ): ViewsChangeDetail {
    const views = catalogue.viewsRowsOf(pair);

    return this.viewsComparison.compareViewsData(
      viewsDataOf(views.head),
      viewsDataOf(views.draft),
    );
  }
}

export function tableSelectionOf(
  table: DraftTable,
  counts: ReportedRowCounts,
  catalogue: DraftCatalogue,
): TableSelection {
  const refusal = catalogue.refusalOf(table.pair);

  if (refusal) {
    return { state: 'refused', code: refusal.code };
  }

  const structure = catalogue.structureOf(table.pair);
  const views = catalogue.viewsOf(table.pair);
  const tableData = tableDataOf(table, counts);

  if (!structure && !views && !tableData) {
    return { state: 'contentEqual' };
  }

  const selection: Mutable<SelectableTableSelection> = { state: 'selectable' };

  if (structure) {
    selection.structure = catalogue.describe(structure);
  }

  if (views) {
    selection.views = unitRefOf(views);
  }

  if (tableData) {
    selection.tableData = tableData;
  }

  return selection;
}

export function tableDataRowsOf(
  table: DraftTable,
  counts: ReportedRowCounts,
  catalogue: DraftCatalogue,
): number {
  if (catalogue.refusalOf(table.pair)) {
    return 0;
  }

  return tableDataOf(table, counts)?.rows ?? 0;
}

// Rows of a table on one side only go with its structure, so they yield no unit.
function tableDataOf(
  { pair }: DraftTable,
  { rowsWithUnits }: ReportedRowCounts,
): TableData | undefined {
  if (!pair.draft || rowsWithUnits === 0) {
    return undefined;
  }

  return { selector: { tableData: [pair.draft.id] }, rows: rowsWithUnits };
}

function rowsSummaryOf({
  total,
  added,
  modified,
  removed,
  renamed,
}: ReportedRowCounts): RevisionChangeSummary {
  return { total, added, modified, removed, renamed };
}

function viewsDataOf(row: Row | undefined): TableViewsData | null {
  if (!row) {
    return null;
  }

  return row.data as unknown as TableViewsData;
}
