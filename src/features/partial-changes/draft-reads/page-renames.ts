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
  type RenameChain,
  TableIdExchanges,
} from 'src/features/partial-changes/draft-reads/id-exchanges';
import {
  type HeadIdHolderRow,
  headIdHoldersSql,
  type RenamedRowIds,
  renamedRowsSql,
} from 'src/features/partial-changes/draft-reads/renamed-rows-sql';
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

// The renamed rows a page looked up in one table: the renames its references follow and the holders its renames meet.
interface LookedUpRenames {
  readonly table: ComparedTable;
  readonly renames: readonly RenamedRowIds[];
}

interface FollowedRenames extends LookedUpRenames {
  readonly references: readonly ChangedReference[];
}

interface TableExchanges extends LookedUpRenames {
  readonly exchanges: TableIdExchanges;
}

// The renames the rows of a page link to: the chains of the page's renames and the renames its references follow, with
// the renamed rows the page did not load, which the page's catalogue adds to give them their units.
export class PageRenames {
  constructor(
    private readonly chains: ReadonlyMap<string, RenameChain>,
    private readonly followed: ReadonlyMap<string, RenamedRow>,
    private readonly renamedRows: ChangedRows,
  ) {}

  public chainOf(
    tableIdentity: string,
    rowIdentity: string,
  ): RenameChain | undefined {
    return this.chains.get(rowKeyOf(tableIdentity, rowIdentity));
  }

  public followedAt(site: ReferenceSite): RenamedRow | undefined {
    return this.followed.get(referenceSiteKeyOf(site));
  }

  public withRenamedRows(pageRows: ChangedRows): ChangedRows {
    const merged = new Map(pageRows);

    for (const [tableIdentity, pairs] of this.renamedRows) {
      const loaded = merged.get(tableIdentity) ?? [];
      const loadedRows = new Set(loaded.map(({ identity }) => identity));

      merged.set(tableIdentity, [
        ...loaded,
        ...pairs.filter(({ identity }) => !loadedRows.has(identity)),
      ]);
    }

    return merged;
  }
}

// One query per referenced table finds the renames the page's references follow, by row id and identity; one
// recursive query per table looks up the Head ids that the page's renames take and it did not load; one query reads
// the versions of the renamed rows found.
@Injectable()
export class PageRenamesReader {
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
  ): Promise<PageRenames> {
    const references = new ChangedReferences(
      compared,
      new TableSchemas(this.schemaStore),
    ).of(entries);
    const followed = await this.readFollowedRenames(references);
    const exchanges = await this.readExchanges(pageRows, compared.tables);

    return new PageRenames(
      chainsOf(exchanges),
      followedOf(followed),
      await this.readRenamedRows([...followed, ...exchanges]),
    );
  }

  private async readFollowedRenames(
    references: readonly ChangedReference[],
  ): Promise<FollowedRenames[]> {
    const followed: FollowedRenames[] = [];

    for (const [table, ofTable] of referencesByTable(references)) {
      followed.push(await this.readFollowedRenamesOf(table, ofTable));
    }

    return followed;
  }

  // The renamed rows that took the Draft ids of the references, kept when they left the ids the references held in Head.
  private async readFollowedRenamesOf(
    table: ComparedTable,
    references: readonly ChangedReference[],
  ): Promise<FollowedRenames> {
    const rowIds = new Set(references.map(({ rowId }) => rowId));
    const rows = await this.transaction.$queryRaw<RenamedRowIds[]>(
      renamedRowsSql(table, [...rowIds]),
    );
    const renames = new Map(
      rows.map((row) => [renameKeyOf(row.headRowId, row.draftRowId), row]),
    );
    const following: ChangedReference[] = [];
    const followed: RenamedRowIds[] = [];

    for (const reference of references) {
      const rename = renames.get(
        renameKeyOf(reference.previousRowId, reference.rowId),
      );

      if (rename) {
        following.push(reference);
        followed.push(rename);
      }
    }

    return { table, references: following, renames: followed };
  }

  private async readExchanges(
    pageRows: ChangedRows,
    tables: readonly ComparedTable[],
  ): Promise<TableExchanges[]> {
    const exchanges: TableExchanges[] = [];

    for (const table of tables) {
      const pairs = pageRows.get(table.identity);

      if (pairs) {
        exchanges.push(await this.readExchangesOf(table, pairs));
      }
    }

    return exchanges;
  }

  private async readExchangesOf(
    table: ComparedTable,
    pairs: readonly RowPair[],
  ): Promise<TableExchanges> {
    const exchanges = new TableIdExchanges(pairs);
    const headRowIds = exchanges.unresolvedHeadRowIds();

    if (headRowIds.length === 0) {
      return { table, exchanges, renames: [] };
    }

    const holders = await this.transaction.$queryRaw<HeadIdHolderRow[]>(
      headIdHoldersSql(table, headRowIds, LONGEST_LISTED_EXCHANGE),
    );
    exchanges.learnHolders(holders);

    return { table, exchanges, renames: holders.flatMap(renamedHolderOf) };
  }

  private async readRenamedRows(
    lookedUp: readonly LookedUpRenames[],
  ): Promise<ChangedRows> {
    const renames = lookedUp.flatMap(({ renames: rows }) => rows);

    if (renames.length === 0) {
      return new Map();
    }

    const versions = await this.snapshotReader.readRowVersions(
      renames.flatMap(({ headVersionId, draftVersionId }) => [
        headVersionId,
        draftVersionId,
      ]),
    );
    const pairs = new Map<string, Map<string, RowPair>>();

    for (const { table, renames: rows } of lookedUp) {
      const ofTable = pairs.get(table.identity) ?? new Map<string, RowPair>();

      for (const row of rows) {
        ofTable.set(row.identity, renamedPairOf(row, versions));
      }

      pairs.set(table.identity, ofTable);
    }

    return new Map(
      [...pairs].map(([tableIdentity, ofTable]) => [
        tableIdentity,
        [...ofTable.values()],
      ]),
    );
  }
}

function referencesByTable(
  references: readonly ChangedReference[],
): Map<ComparedTable, ChangedReference[]> {
  const byTable = new Map<ComparedTable, ChangedReference[]>();

  for (const reference of references) {
    byTable.set(reference.referenced, [
      ...(byTable.get(reference.referenced) ?? []),
      reference,
    ]);
  }

  return byTable;
}

// A holder that a rename moved off its Head id; a holder deleted in the Draft or no holder at all is not renamed.
function renamedHolderOf({
  identity,
  headRowId,
  draftRowId,
  headVersionId,
  draftVersionId,
}: HeadIdHolderRow): RenamedRowIds[] {
  if (
    identity === null ||
    draftRowId === null ||
    headVersionId === null ||
    draftVersionId === null
  ) {
    return [];
  }

  return [{ identity, headRowId, draftRowId, headVersionId, draftVersionId }];
}

function chainsOf(
  exchanges: readonly TableExchanges[],
): Map<string, RenameChain> {
  const chains = new Map<string, RenameChain>();

  for (const { table, exchanges: ofTable } of exchanges) {
    for (const [rowIdentity, chain] of ofTable.chains()) {
      chains.set(rowKeyOf(table.identity, rowIdentity), chain);
    }
  }

  return chains;
}

function followedOf(
  followed: readonly FollowedRenames[],
): Map<string, RenamedRow> {
  return new Map(
    followed.flatMap(({ table, references }) =>
      references.map(({ site, rowId }) => [
        referenceSiteKeyOf(site),
        { tableIdentity: table.identity, rowId },
      ]),
    ),
  );
}

function renamedPairOf(
  { identity, headVersionId, draftVersionId }: RenamedRowIds,
  versions: ReadonlyMap<string, Row>,
): RowPair {
  return {
    identity,
    head: versionOf(versions, headVersionId),
    draft: versionOf(versions, draftVersionId),
  };
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

function renameKeyOf(previousRowId: string, rowId: string): string {
  return JSON.stringify([previousRowId, rowId]);
}
