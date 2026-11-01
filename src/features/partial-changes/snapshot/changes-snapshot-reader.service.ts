import { Injectable } from '@nestjs/common';
import { sql, type Row } from 'src/engine-prisma-types';
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
