import { Injectable } from '@nestjs/common';
import type { Row } from 'src/engine-prisma-types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import { DraftCatalogue } from 'src/features/partial-changes/draft-reads/draft-catalogue';
import { encodeRowCursor } from 'src/features/partial-changes/draft-reads/draft-cursor';
import {
  type DraftRowEntry,
  draftRowItemOf,
} from 'src/features/partial-changes/draft-reads/draft-row';
import type { DraftTable } from 'src/features/partial-changes/draft-reads/draft-tables';
import { RowRenamesReader } from 'src/features/partial-changes/draft-reads/row-renames';
import type { ReportedRowPair } from 'src/features/partial-changes/draft-reads/reported-rows-sql';
import type { HeadSchemaCheck } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { DraftEdge } from 'src/features/partial-changes/queries/impl/draft-reads';
import type { DraftRowItem } from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import type {
  ChangedRows,
  RowPair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import type { ComparedSnapshot } from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';
import { PluginService } from 'src/features/plugin/plugin.service';
import { RowDiffService } from 'src/features/revision-changes/services/row-diff.service';
import type { FieldChange } from 'src/features/revision-changes/types';
import type { HeadAndDraft } from 'src/features/share/branch-revisions/branch-revision-reader';

// The reported rows of one table on a page, in page order.
export interface PagedTable {
  readonly table: DraftTable;
  readonly pairs: readonly ReportedRowPair[];
}

interface PageRow {
  readonly paged: PagedTable;
  readonly pair: ReportedRowPair;
  readonly head?: Row;
  readonly draft?: Row;
}

const SIDES: readonly RevisionSide[] = ['head', 'draft'];

@Injectable()
export class DraftRowItems {
  constructor(
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly rowDiff: RowDiffService,
    private readonly plugins: PluginService,
    private readonly renamesReader: RowRenamesReader,
  ) {}

  public async edgesOf(
    page: readonly PagedTable[],
    compared: ComparedSnapshot,
  ): Promise<DraftEdge<DraftRowItem>[]> {
    if (page.length === 0) {
      return [];
    }

    const versions = await this.snapshotReader.readRowVersions(
      versionIdsOf(page),
    );
    const rows = page.flatMap((paged) =>
      paged.pairs.map((pair) => pageRowOf(paged, pair, versions)),
    );
    const fieldChanges = await this.fieldChangesOf(rows, compared.snapshot);
    const entries = rows.map((row, index) => ({
      row,
      entry: entryOf(row, fieldChanges[index] ?? []),
    }));
    const pageRows = changedRowsOf(rows, compared.headSchema);
    const renames = await this.renamesReader.readOf(
      entries.map(({ entry }) => entry),
      pageRows,
      compared,
    );
    const catalogue = DraftCatalogue.withChangedRows(
      compared,
      renames.withRenamedRows(pageRows),
    );

    return entries.map(({ row, entry }) => ({
      cursor: encodeRowCursor({
        table: row.paged.table.position,
        rowId: row.pair.rowId,
      }),
      node: draftRowItemOf(entry, catalogue, renames),
    }));
  }

  // The native value diff of each row's Head and Draft data, after the formula values of the page's rows are computed.
  private async fieldChangesOf(
    rows: readonly PageRow[],
    revisions: HeadAndDraft,
  ): Promise<FieldChange[][]> {
    const computed = rows.map(computableCopyOf);

    for (const side of SIDES) {
      for (const [tableId, tableRows] of rowsByTableIdOn(computed, side)) {
        await this.plugins.computeRows({
          revisionId: revisionIdOn(revisions, side),
          tableId,
          rows: tableRows,
        });
      }
    }

    return computed.map(({ head, draft }) =>
      this.rowDiff.analyzeFieldChanges(head?.data ?? null, draft?.data ?? null),
    );
  }
}

function pageRowOf(
  paged: PagedTable,
  pair: ReportedRowPair,
  versions: ReadonlyMap<string, Row>,
): PageRow {
  return {
    paged,
    pair,
    head: versionOf(versions, pair.headVersionId),
    draft: versionOf(versions, pair.draftVersionId),
  };
}

function entryOf(
  { paged, pair, head, draft }: PageRow,
  fieldChanges: readonly FieldChange[],
): DraftRowEntry {
  return { table: paged.table.pair, pair, head, draft, fieldChanges };
}

// The catalogue of a page holds the pairs the listing loads for the page's row ids; it loads none of a refused table.
function changedRowsOf(
  rows: readonly PageRow[],
  { refusedTablesByIdentity }: HeadSchemaCheck,
): ChangedRows {
  const changedRows = new Map<string, RowPair[]>();

  for (const { paged, pair, head, draft } of rows) {
    const { identity } = paged.table.pair;

    if (
      paged.table.rows?.kind === 'compared' &&
      pair.yieldsUnit &&
      !refusedTablesByIdentity.has(identity)
    ) {
      const pairs = changedRows.get(identity) ?? [];

      pairs.push({ identity: pair.identity, head, draft });
      changedRows.set(identity, pairs);
    }
  }

  return changedRows;
}

function computableCopyOf(row: PageRow): PageRow {
  return {
    ...row,
    head: rowWithCopiedData(row.head),
    draft: rowWithCopiedData(row.draft),
  };
}

function rowWithCopiedData(row: Row | undefined): Row | undefined {
  if (!row) {
    return undefined;
  }

  return { ...row, data: structuredClone(row.data) };
}

function rowsByTableIdOn(
  rows: readonly PageRow[],
  side: RevisionSide,
): Map<string, Row[]> {
  const rowsByTable = new Map<string, Row[]>();

  for (const row of rows) {
    const version = row[side];
    const table = row.paged.table.pair[side];

    if (version && table) {
      const tableRows = rowsByTable.get(table.id) ?? [];

      tableRows.push(version);
      rowsByTable.set(table.id, tableRows);
    }
  }

  return rowsByTable;
}

function revisionIdOn(
  { headRevisionId, draftRevisionId }: HeadAndDraft,
  side: RevisionSide,
): string {
  if (side === 'head') {
    return headRevisionId;
  }

  return draftRevisionId;
}

function versionIdsOf(page: readonly PagedTable[]): string[] {
  return page
    .flatMap(({ pairs }) => pairs)
    .flatMap(({ headVersionId, draftVersionId }) => [
      headVersionId,
      draftVersionId,
    ])
    .filter((versionId): versionId is string => versionId !== null);
}

function versionOf(
  versions: ReadonlyMap<string, Row>,
  versionId: string | null,
): Row | undefined {
  if (versionId === null) {
    return undefined;
  }

  const row = versions.get(versionId);

  if (!row) {
    throw new Error(`Row version ${versionId} of a reported pair is missing`);
  }

  return row;
}
