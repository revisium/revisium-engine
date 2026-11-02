import { Injectable } from '@nestjs/common';
import { type Row, sql } from 'src/engine-prisma-types';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface BranchRef {
  readonly projectId: string;
  readonly branchName: string;
}

export interface HeadAndDraft {
  readonly branchId: string;
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
}

export interface StoredTable {
  readonly versionId: string;
  readonly createdId: string;
  readonly id: string;
  readonly readonly: boolean;
  readonly system: boolean;
}

export type StoredTableVersion = Pick<StoredTable, 'versionId' | 'readonly'>;

export interface StoredSystemTable {
  readonly version?: StoredTableVersion;
  readonly rows: readonly Row[];
}

export type StoredSystemTables<TableId extends SystemTables> = Readonly<
  Record<TableId, StoredSystemTable>
>;

interface LinkedTable extends StoredTable {
  readonly revisionId: string;
}

@Injectable()
export class BranchRevisionReader {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly shareQueries: ShareTransactionalQueries,
  ) {}

  private get client() {
    return this.transactionService.getTransactionOrPrisma();
  }

  public async resolveHeadAndDraft({
    projectId,
    branchName,
  }: BranchRef): Promise<HeadAndDraft> {
    const { id: branchId } = await this.shareQueries.findBranchInProjectOrThrow(
      projectId,
      branchName,
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

  public async readTables(revisionId: string): Promise<StoredTable[]> {
    const tablesByRevision = await this.readTablesOfRevisions([revisionId]);

    return tablesByRevision.get(revisionId) ?? [];
  }

  public async readTablesOfRevisions(
    revisionIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredTable[]>> {
    const links = await this.client.$queryRaw<LinkedTable[]>(sql`
      SELECT rt."A" AS "revisionId", t."versionId", t."createdId", t."id", t."readonly", t."system"
      FROM "_RevisionToTable" rt
      JOIN "Table" t ON t."versionId" = rt."B"
      WHERE rt."A" = ANY(${[...revisionIds]}::text[])
    `);

    return groupedByRevision(links);
  }

  public async readSystemRows<TableId extends SystemTables>(
    tables: readonly StoredTable[],
    tableIds: readonly TableId[],
  ): Promise<StoredSystemTables<TableId>> {
    const systemTables: [TableId, StoredSystemTable][] = [];

    for (const tableId of tableIds) {
      systemTables.push([
        tableId,
        await this.readSystemTable(systemTableOf(tables, tableId)),
      ]);
    }

    return Object.fromEntries(systemTables) as StoredSystemTables<TableId>;
  }

  private async readSystemTable(
    table: StoredTable | undefined,
  ): Promise<StoredSystemTable> {
    if (!table) {
      return { rows: [] };
    }

    return {
      version: storedVersionOf(table),
      rows: await this.client.row.findMany({
        where: { tables: { some: { versionId: table.versionId } } },
      }),
    };
  }
}

export function systemTableOf(
  tables: readonly StoredTable[],
  tableId: SystemTables,
): StoredTable | undefined {
  return tables.find(({ id, system }) => system && id === tableId);
}

export function storedVersionOf({
  versionId,
  readonly,
}: StoredTable): StoredTableVersion {
  return { versionId, readonly };
}

export function userTableVersionIdsOf(
  tables: readonly StoredTable[],
): Map<string, string> {
  return new Map(
    tables
      .filter(({ system }) => !system)
      .map(({ id, versionId }) => [id, versionId]),
  );
}

function groupedByRevision(
  links: readonly LinkedTable[],
): Map<string, StoredTable[]> {
  const tablesByRevision = new Map<string, StoredTable[]>();

  for (const link of links) {
    const tables = tablesByRevision.get(link.revisionId) ?? [];
    tables.push(link);
    tablesByRevision.set(link.revisionId, tables);
  }

  return tablesByRevision;
}
