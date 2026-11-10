import { Injectable } from '@nestjs/common';
import type { Row } from 'src/engine-prisma-types';
import { TableSchemas } from 'src/features/partial-changes/closure/table-schemas';
import {
  type ChangedReference,
  ChangedReferences,
  type ReferenceSite,
  referenceSiteKeyOf,
} from 'src/features/partial-changes/draft-reads/changed-references';
import type { DraftRowEntry } from 'src/features/partial-changes/draft-reads/draft-row';
import {
  LONGEST_LISTED_EXCHANGE,
  TableIdExchanges,
} from 'src/features/partial-changes/draft-reads/id-exchanges';
import {
  type HeadIdHolderRow,
  headIdHoldersSql,
  type RenamedRowVersions,
  renamedRowsSql,
} from 'src/features/partial-changes/draft-reads/renamed-rows-sql';
import type { IdExchangeTermination } from 'src/features/partial-changes/queries/impl/draft-reads';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import type {
  ChangedRows,
  ComparedTable,
  RowPair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { ComparedSnapshot } from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

// A renamed row, by the identity of its table and the Draft id it took.
export interface RenamedRow {
  readonly tableIdentity: string;
  readonly rowId: string;
}

export interface RenamedRowChain {
  readonly renames: readonly RenamedRow[];
  readonly termination: IdExchangeTermination;
}

interface TableRenames {
  readonly table: ComparedTable;
  readonly rows: readonly RenamedRowVersions[];
}

interface TableHolders {
  readonly table: ComparedTable;
  readonly exchanges: TableIdExchanges;
  readonly holders: readonly HeadIdHolderRow[];
}

// The renames the rows of a page link to: the chains of the page's renames and the renames its references follow, with
// the renamed rows the page did not load, which the page's catalogue adds to give them their units.
export class RowRenames {
  constructor(
    private readonly chains: ReadonlyMap<string, RenamedRowChain>,
    private readonly followed: ReadonlyMap<string, RenamedRow>,
    private readonly renamedRows: ChangedRows,
  ) {}

  public chainOf(
    tableIdentity: string,
    rowIdentity: string,
  ): RenamedRowChain | undefined {
    return this.chains.get(rowKeyOf(tableIdentity, rowIdentity));
  }

  public followedAt(site: ReferenceSite): RenamedRow | undefined {
    return this.followed.get(referenceSiteKeyOf(site));
  }

  // The page's rows with the renamed rows it did not load, each row once.
  public withRenamedRows(pageRows: ChangedRows): ChangedRows {
    const merged = new Map(pageRows);

    for (const [tableIdentity, pairs] of this.renamedRows) {
      const loaded = merged.get(tableIdentity) ?? [];
      const loadedRows = new Set(loaded.map(({ identity }) => identity));

      merged.set(tableIdentity, [
        ...loaded,
        ...distinctPairsOf(pairs).filter(
          ({ identity }) => !loadedRows.has(identity),
        ),
      ]);
    }

    return merged;
  }
}

// One query per table finds the renames the page's references follow, by row id and identity; one recursive query per
// table looks up the Head ids that the page's renames take and it did not load; one query reads their versions.
@Injectable()
export class RowRenamesReader {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly schemaStore: JsonSchemaStoreService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  public async readOf(
    entries: readonly DraftRowEntry[],
    pageRows: ChangedRows,
    compared: ComparedSnapshot,
  ): Promise<RowRenames> {
    const references = new ChangedReferences(
      compared,
      new TableSchemas(this.schemaStore),
    ).of(entries);
    const renamed = await this.readRenamedRows(references);
    const holders = await this.readHolders(pageRows, compared.tables);
    const versions = await this.readVersions([
      ...renamed.flatMap(({ rows }) => rows),
      ...holders.flatMap(({ holders: rows }) => renamedHoldersOf(rows)),
    ]);

    return new RowRenames(
      chainsOf(holders),
      followedOf(references, renamed, versions),
      renamedRowsOf(renamed, holders, versions),
    );
  }

  private async readRenamedRows(
    references: readonly ChangedReference[],
  ): Promise<TableRenames[]> {
    const renamed: TableRenames[] = [];

    for (const [table, rowIds] of referencedRowIdsOf(references)) {
      renamed.push({
        table,
        rows: await this.transaction.$queryRaw<RenamedRowVersions[]>(
          renamedRowsSql(table, [...rowIds]),
        ),
      });
    }

    return renamed;
  }

  private async readHolders(
    pageRows: ChangedRows,
    tables: readonly ComparedTable[],
  ): Promise<TableHolders[]> {
    const holders: TableHolders[] = [];

    for (const table of tables) {
      const pairs = pageRows.get(table.identity);

      if (pairs) {
        holders.push(await this.readHoldersOf(table, pairs));
      }
    }

    return holders;
  }

  private async readHoldersOf(
    table: ComparedTable,
    pairs: readonly RowPair[],
  ): Promise<TableHolders> {
    const exchanges = new TableIdExchanges(pairs);
    const headRowIds = exchanges.unresolvedHeadRowIds();

    if (headRowIds.length === 0) {
      return { table, exchanges, holders: [] };
    }

    const holders = await this.transaction.$queryRaw<HeadIdHolderRow[]>(
      headIdHoldersSql(table, headRowIds, LONGEST_LISTED_EXCHANGE),
    );
    exchanges.learnHolders(holders);

    return { table, exchanges, holders };
  }

  private readVersions(
    rows: readonly RenamedRowVersions[],
  ): Promise<ReadonlyMap<string, Row>> {
    if (rows.length === 0) {
      return Promise.resolve(new Map());
    }

    return this.snapshotReader.readRowVersions(
      rows.flatMap(({ headVersionId, draftVersionId }) => [
        headVersionId,
        draftVersionId,
      ]),
    );
  }
}

function referencedRowIdsOf(
  references: readonly ChangedReference[],
): Map<ComparedTable, Set<string>> {
  const rowIds = new Map<ComparedTable, Set<string>>();

  for (const { referenced, rowId } of references) {
    const ofTable = rowIds.get(referenced) ?? new Set<string>();

    ofTable.add(rowId);
    rowIds.set(referenced, ofTable);
  }

  return rowIds;
}

// The holders that a rename moved off their Head id; the others were deleted or held no row.
function renamedHoldersOf(
  holders: readonly HeadIdHolderRow[],
): RenamedRowVersions[] {
  return holders.flatMap(({ identity, headVersionId, draftVersionId }) =>
    identity === null || headVersionId === null || draftVersionId === null
      ? []
      : [{ identity, headVersionId, draftVersionId }],
  );
}

function chainsOf(
  holders: readonly TableHolders[],
): Map<string, RenamedRowChain> {
  const chains = new Map<string, RenamedRowChain>();

  for (const { table, exchanges } of holders) {
    for (const [rowIdentity, { renames, termination }] of exchanges.chains()) {
      chains.set(rowKeyOf(table.identity, rowIdentity), {
        renames: renames.map(({ draftRowId }) => ({
          tableIdentity: table.identity,
          rowId: draftRowId,
        })),
        termination,
      });
    }
  }

  return chains;
}

// A reference follows the rename of the row it names under the rename's previous id in Head and its new id in the Draft.
function followedOf(
  references: readonly ChangedReference[],
  renamed: readonly TableRenames[],
  versions: ReadonlyMap<string, Row>,
): Map<string, RenamedRow> {
  const renames = new Set(
    renamed.flatMap(({ table, rows }) =>
      rows.map((row) =>
        renameKeyOf(
          table.identity,
          versionOf(versions, row.headVersionId).id,
          versionOf(versions, row.draftVersionId).id,
        ),
      ),
    ),
  );
  const followed = new Map<string, RenamedRow>();

  for (const { site, referenced, previousRowId, rowId } of references) {
    if (renames.has(renameKeyOf(referenced.identity, previousRowId, rowId))) {
      followed.set(referenceSiteKeyOf(site), {
        tableIdentity: referenced.identity,
        rowId,
      });
    }
  }

  return followed;
}

function renamedRowsOf(
  renamed: readonly TableRenames[],
  holders: readonly TableHolders[],
  versions: ReadonlyMap<string, Row>,
): ChangedRows {
  const pairs = new Map<string, RowPair[]>();
  const tableRows = [
    ...renamed,
    ...holders.map(({ table, holders: rows }) => ({
      table,
      rows: renamedHoldersOf(rows),
    })),
  ];

  for (const { table, rows } of tableRows) {
    pairs.set(table.identity, [
      ...(pairs.get(table.identity) ?? []),
      ...rows.map(({ identity, headVersionId, draftVersionId }) => ({
        identity,
        head: versionOf(versions, headVersionId),
        draft: versionOf(versions, draftVersionId),
      })),
    ]);
  }

  return pairs;
}

function distinctPairsOf(pairs: readonly RowPair[]): RowPair[] {
  return [...new Map(pairs.map((pair) => [pair.identity, pair])).values()];
}

function versionOf(versions: ReadonlyMap<string, Row>, versionId: string): Row {
  const row = versions.get(versionId);

  if (!row) {
    throw new Error(`Row version ${versionId} of a renamed row is missing`);
  }

  return row;
}

function rowKeyOf(tableIdentity: string, rowIdentity: string): string {
  return JSON.stringify([tableIdentity, rowIdentity]);
}

function renameKeyOf(
  tableIdentity: string,
  previousRowId: string,
  rowId: string,
): string {
  return JSON.stringify([tableIdentity, previousRowId, rowId]);
}
