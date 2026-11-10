import { Injectable } from '@nestjs/common';
import { HeadViewsMigration } from 'src/features/partial-changes/catalogue/head-views-migration';
import {
  compareTablePositions,
  type TablePosition,
} from 'src/features/partial-changes/draft-reads/draft-cursor';
import type { TableFilters } from 'src/features/partial-changes/draft-reads/draft-read-request';
import {
  type ReportedRowCounts,
  ReportedRowCountsReader,
} from 'src/features/partial-changes/draft-reads/reported-row-counts-reader';
import type { TableRows } from 'src/features/partial-changes/draft-reads/reported-rows-sql';
import { TableCatalogue } from 'src/features/partial-changes/draft-reads/table-catalogue';
import {
  hasChangeTypeAmong,
  hasIdContaining,
} from 'src/features/partial-changes/draft-reads/table-filters';
import type { DraftReadState } from 'src/features/partial-changes/queries/impl/draft-reads';
import {
  type ChangesBranch,
  type ComparedTable,
  hasDifferentVersions,
  publicTableIdOf,
  type TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  type ComparedSnapshot,
  ComparedSnapshotReader,
  type ComparisonScope,
} from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';
import { ChangeType } from 'src/features/revision-changes/types';

export interface DraftTable {
  readonly pair: TablePair;
  readonly position: TablePosition;
  readonly rows?: TableRows;
}

const PARTIAL_OPERATION: ComparisonScope = { wholeDraft: false };

const NO_REPORTED_ROWS: ReportedRowCounts = {
  total: 0,
  added: 0,
  modified: 0,
  removed: 0,
  renamed: 0,
  rowsWithUnits: 0,
};

@Injectable()
export class DraftTablesReader {
  constructor(
    private readonly comparedSnapshotReader: ComparedSnapshotReader,
    private readonly headViews: HeadViewsMigration,
    private readonly countsReader: ReportedRowCountsReader,
  ) {}

  public async read(branch: ChangesBranch): Promise<DraftTables> {
    const compared = await this.comparedSnapshotReader.readComparedSnapshot(
      branch,
      PARTIAL_OPERATION,
    );

    return new DraftTables(
      compared,
      new TableCatalogue(compared, this.headViews),
      this.countsReader,
    );
  }
}

// The tables a Draft read lists, in order, with their row counts read once per call.
export class DraftTables {
  public readonly listed: readonly DraftTable[];

  private readonly rowCounts = new Map<string, Promise<ReportedRowCounts>>();

  constructor(
    public readonly compared: ComparedSnapshot,
    public readonly catalogue: TableCatalogue,
    private readonly countsReader: ReportedRowCountsReader,
  ) {
    this.listed = listedTablesOf(compared);
  }

  public get readState(): DraftReadState {
    const { snapshot, headSchema } = this.compared;

    return {
      headRevisionId: snapshot.headRevisionId,
      draftRevisionId: snapshot.draftRevisionId,
      refusedTables: headSchema.refusedTables,
    };
  }

  public async matching({
    changeTypes,
    search,
  }: TableFilters): Promise<DraftTable[]> {
    const matching: DraftTable[] = [];

    for (const table of this.listed) {
      const { head, draft } = table.pair;

      if (
        hasIdContaining([draft?.id, head?.id], search) &&
        (await this.hasChangeTypeAmong(table, changeTypes))
      ) {
        matching.push(table);
      }
    }

    return matching;
  }

  public rowCountsOf({ pair, rows }: DraftTable): Promise<ReportedRowCounts> {
    if (!rows) {
      return Promise.resolve(NO_REPORTED_ROWS);
    }

    const counts =
      this.rowCounts.get(pair.identity) ??
      this.countsReader.readRowCounts(rows);

    this.rowCounts.set(pair.identity, counts);

    return counts;
  }

  public async changeTypeOf(table: DraftTable): Promise<ChangeType> {
    const { head, draft } = table.pair;

    if (!head) {
      return ChangeType.Added;
    }

    if (!draft) {
      return ChangeType.Removed;
    }

    if (head.id === draft.id) {
      return ChangeType.Modified;
    }

    if (await this.changedBeyondTableId(table)) {
      return ChangeType.RenamedAndModified;
    }

    return ChangeType.Renamed;
  }

  // A renamed table is RENAMED or RENAMED_AND_MODIFIED, so its row counts are read only when the filter tells them apart.
  private async hasChangeTypeAmong(
    table: DraftTable,
    changeTypes: readonly ChangeType[] | undefined,
  ): Promise<boolean> {
    const { head, draft } = table.pair;

    if (head && draft && head.id !== draft.id) {
      const renamed = hasChangeTypeAmong(ChangeType.Renamed, changeTypes);

      if (
        renamed ===
        hasChangeTypeAmong(ChangeType.RenamedAndModified, changeTypes)
      ) {
        return renamed;
      }
    }

    return hasChangeTypeAmong(await this.changeTypeOf(table), changeTypes);
  }

  private async changedBeyondTableId(table: DraftTable): Promise<boolean> {
    if (
      this.catalogue.refusalOf(table.pair) ||
      this.catalogue.changedBeyondTableId(table.pair)
    ) {
      return true;
    }

    const { total } = await this.rowCountsOf(table);

    return total > 0;
  }
}

function listedTablesOf({ snapshot, tables }: ComparedSnapshot): DraftTable[] {
  const compared = new Map(tables.map((table) => [table.identity, table]));

  return snapshot.tables
    .filter(isListed)
    .map((pair) => draftTableOf(pair, compared.get(pair.identity)))
    .sort((left, right) =>
      compareTablePositions(left.position, right.position),
    );
}

function isListed({ head, draft }: TablePair): boolean {
  return (
    !head ||
    !draft ||
    head.id !== draft.id ||
    head.versionId !== draft.versionId
  );
}

function draftTableOf(
  pair: TablePair,
  compared: ComparedTable | undefined,
): DraftTable {
  const position = { tableId: publicTableIdOf(pair), headOnly: !pair.draft };
  const rows = tableRowsOf(pair, compared);

  if (!rows) {
    return { pair, position };
  }

  return { pair, position, rows };
}

function tableRowsOf(
  { head, draft }: TablePair,
  compared: ComparedTable | undefined,
): TableRows | undefined {
  if (head && !draft) {
    return { kind: 'oneSided', side: 'head', tableVersionId: head.versionId };
  }

  if (!head && draft) {
    return { kind: 'oneSided', side: 'draft', tableVersionId: draft.versionId };
  }

  if (compared && hasDifferentVersions(compared)) {
    return { kind: 'compared', table: compared };
  }

  return undefined;
}
