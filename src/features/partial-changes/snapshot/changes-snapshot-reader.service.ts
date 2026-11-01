import { Injectable } from '@nestjs/common';
import { empty, type Row, type Sql, sql } from 'src/engine-prisma-types';
import {
  changedRowCountSql,
  type ChangedRowPairIds,
  changedRowPairsSql,
} from 'src/features/partial-changes/snapshot/changed-row-pairs-sql';
import {
  type BranchRevisions,
  type ChangedRows,
  type ChangesBranch,
  type ChangesSnapshot,
  type ComparedTable,
  hasDifferentVersions,
  type RowPair,
  type SystemRows,
  type SystemTableRows,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { rowDigestSql } from 'src/features/partial-changes/snapshot/row-digest-sql';
import {
  pairUserTablesByIdentity,
  type RevisionTables,
  type StoredTable,
} from 'src/features/partial-changes/snapshot/table-pairs';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

const MAX_IDS_FOR_INDEXED_LOOKUP = 100;

export interface ReferrerQuery {
  readonly jsonPath: string;
  readonly rowIds: readonly string[];
  readonly exceptRows: readonly string[];
}

export interface FirstReferrer {
  readonly referencedId: string;
  readonly rowId: string;
}

export interface UnresolvedReferenceQuery {
  readonly jsonPath: string;
  readonly exceptRows: readonly string[];
  readonly referencedTableVersionId: string;
  readonly changedRowIds: readonly string[];
}

@Injectable()
export class ChangesSnapshotReader {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly shareQueries: ShareTransactionalQueries,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  public async readSnapshot(branch: ChangesBranch): Promise<ChangesSnapshot> {
    const revisions = await this.resolveRevisions(branch);
    const tables = await this.readRevisionTables(revisions);
    const systemRows = await this.readSystemRows(tables);

    return {
      ...revisions,
      tables: pairUserTablesByIdentity(tables, systemRows.schemas),
      systemRows,
    };
  }

  public async countChangedRows(
    tables: readonly ComparedTable[],
  ): Promise<number> {
    let count = 0;

    for (const table of tables.filter(hasDifferentVersions)) {
      count += await this.countChangedRowsOf(table);
    }

    return count;
  }

  public async readChangedRows(
    tables: readonly ComparedTable[],
  ): Promise<ChangedRows> {
    const changedRows = new Map<string, readonly RowPair[]>();

    for (const table of tables.filter(hasDifferentVersions)) {
      changedRows.set(table.identity, await this.readChangedRowsOf(table));
    }

    return changedRows;
  }

  public async readExistingRowIds(
    tableVersionId: string,
    rowIds: readonly string[],
  ): Promise<string[]> {
    const rows = await this.transaction.row.findMany({
      where: {
        id: { in: [...rowIds] },
        tables: { some: { versionId: tableVersionId } },
      },
      select: { id: true },
    });

    return rows.map(({ id }) => id);
  }

  public async countRowLinks(tableVersionId: string): Promise<number> {
    const [result] = await this.transaction.$queryRaw<{ count: number }[]>(sql`
      SELECT count(*)::int AS "count" FROM "_RowToTable" WHERE "B" = ${tableVersionId}
    `);

    return result?.count ?? 0;
  }

  public readFirstReferrers(
    tableVersionId: string,
    { jsonPath, rowIds, exceptRows }: ReferrerQuery,
  ): Promise<FirstReferrer[]> {
    return this.transaction.$queryRaw<FirstReferrer[]>(sql`
      SELECT v.value #>> '{}' AS "referencedId", min(r."id" COLLATE "C") AS "rowId"
      FROM "Row" r
      JOIN "_RowToTable" rt ON rt."A" = r."versionId"
      CROSS JOIN LATERAL jsonb_path_query(r."data", ${jsonPath}::jsonpath) AS v(value)
      WHERE rt."B" = ${tableVersionId}
        ${indexedReferenceFilter(jsonPath, rowIds)}
        AND jsonb_typeof(v.value) = 'string'
        AND v.value #>> '{}' = ANY(${[...rowIds]}::text[])
        AND r."createdId" <> ALL(${[...exceptRows]}::text[])
      GROUP BY v.value #>> '{}'
      ORDER BY (v.value #>> '{}') COLLATE "C"
    `);
  }

  public readUnresolvedReferences(
    tableVersionId: string,
    {
      jsonPath,
      exceptRows,
      referencedTableVersionId,
      changedRowIds,
    }: UnresolvedReferenceQuery,
  ): Promise<FirstReferrer[]> {
    return this.transaction.$queryRaw<FirstReferrer[]>(sql`
      SELECT v.value #>> '{}' AS "referencedId", min(r."id" COLLATE "C") AS "rowId"
      FROM "Row" r
      JOIN "_RowToTable" rt ON rt."A" = r."versionId"
      CROSS JOIN LATERAL jsonb_path_query(r."data", ${jsonPath}::jsonpath) AS v(value)
      WHERE rt."B" = ${tableVersionId}
        AND jsonb_typeof(v.value) = 'string'
        AND r."createdId" <> ALL(${[...exceptRows]}::text[])
        AND (
          v.value #>> '{}' = ANY(${[...changedRowIds]}::text[])
          OR NOT EXISTS (
            SELECT 1
            FROM "Row" referenced
            JOIN "_RowToTable" referenced_rt ON referenced_rt."A" = referenced."versionId"
            WHERE referenced_rt."B" = ${referencedTableVersionId}
              AND referenced."id" = v.value #>> '{}'
          )
        )
      GROUP BY v.value #>> '{}'
      ORDER BY (v.value #>> '{}') COLLATE "C"
    `);
  }

  public async readRowDigest(tableVersionId: string): Promise<string> {
    const [result] = await this.transaction.$queryRaw<{ digest: string }[]>(
      rowDigestSql(tableVersionId),
    );

    return result?.digest ?? '';
  }

  private async countChangedRowsOf(table: ComparedTable): Promise<number> {
    const [result] = await this.transaction.$queryRaw<{ count: number }[]>(
      changedRowCountSql(table),
    );

    return result?.count ?? 0;
  }

  private async readChangedRowsOf(table: ComparedTable): Promise<RowPair[]> {
    const pairs = await this.transaction.$queryRaw<ChangedRowPairIds[]>(
      changedRowPairsSql(table),
    );
    const versions = await this.readRowVersions(pairs.flatMap(versionIdsOf));

    return pairs.map((pair) => ({
      identity: pair.identity,
      head: versionOf(versions, pair.headVersionId),
      draft: versionOf(versions, pair.draftVersionId),
    }));
  }

  private async readRowVersions(
    versionIds: string[],
  ): Promise<ReadonlyMap<string, Row>> {
    const rows = await this.transaction.$queryRaw<Row[]>(sql`
      SELECT * FROM "Row" WHERE "versionId" = ANY(${versionIds}::text[])
    `);

    return new Map(rows.map((row) => [row.versionId, row]));
  }

  private async resolveRevisions(
    branch: ChangesBranch,
  ): Promise<BranchRevisions> {
    const { id: branchId } = await this.shareQueries.findBranchInProjectOrThrow(
      branch.projectId,
      branch.branchName,
    );
    const head =
      await this.shareQueries.findHeadRevisionInBranchOrThrow(branchId);
    const draft =
      await this.shareQueries.findDraftRevisionInBranchOrThrow(branchId);

    return {
      branchId,
      headRevisionId: head.id,
      draftRevisionId: draft.id,
    };
  }

  private async readRevisionTables(
    revisions: BranchRevisions,
  ): Promise<RevisionTables> {
    return {
      head: await this.readTables(revisions.headRevisionId),
      draft: await this.readTables(revisions.draftRevisionId),
    };
  }

  private readTables(revisionId: string): Promise<StoredTable[]> {
    return this.transaction.table.findMany({
      where: { revisions: { some: { id: revisionId } } },
      select: {
        versionId: true,
        createdId: true,
        id: true,
        system: true,
      },
    });
  }

  private async readSystemRows(tables: RevisionTables): Promise<SystemRows> {
    return {
      schemas: await this.readSystemTable(tables, SystemTables.Schema),
      migrations: await this.readSystemTable(tables, SystemTables.Migration),
      views: await this.readSystemTable(tables, SystemTables.Views),
      sharedSchemas: await this.readSystemTable(
        tables,
        SystemTables.SharedSchemas,
      ),
    };
  }

  private async readSystemTable(
    tables: RevisionTables,
    tableId: SystemTables,
  ): Promise<SystemTableRows> {
    const head = systemTableOf(tables.head, tableId);
    const draft = systemTableOf(tables.draft, tableId);

    return {
      head: await this.readRows(head),
      draft: await this.readRows(draft),
      versionIds: { head: head?.versionId, draft: draft?.versionId },
    };
  }

  private async readRows(table: StoredTable | undefined): Promise<Row[]> {
    if (!table) {
      return [];
    }

    return this.transaction.row.findMany({
      where: { tables: { some: { versionId: table.versionId } } },
    });
  }
}

function indexedReferenceFilter(
  jsonPath: string,
  rowIds: readonly string[],
): Sql {
  if (rowIds.length > MAX_IDS_FOR_INDEXED_LOOKUP) {
    return empty;
  }

  const equalities = rowIds.map((rowId) => `@ == ${JSON.stringify(rowId)}`);
  const referencing = `${jsonPath} ? (${equalities.join(' || ')})`;

  return sql`AND r."data" @? ${referencing}::jsonpath`;
}

function versionIdsOf(pair: ChangedRowPairIds): string[] {
  return [pair.headVersionId, pair.draftVersionId].filter(
    (versionId): versionId is string => versionId !== null,
  );
}

function versionOf(
  versions: ReadonlyMap<string, Row>,
  versionId: string | null,
): Row | undefined {
  if (versionId === null) {
    return undefined;
  }

  return versions.get(versionId);
}

function systemTableOf(
  tables: readonly StoredTable[],
  tableId: SystemTables,
): StoredTable | undefined {
  return tables.find((table) => table.system && table.id === tableId);
}
