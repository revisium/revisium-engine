import { Injectable } from '@nestjs/common';
import { type Row, sql } from 'src/engine-prisma-types';
import { ACTIVE_MIGRATION_STATUSES } from 'src/features/migration/types/migration.types';
import {
  BranchRevisionReader,
  type HeadAndDraft,
  type StoredTable,
  type StoredTableVersion,
  storedVersionOf,
  systemTableOf,
  userTableVersionIdsOf,
} from 'src/features/share/branch-revisions/branch-revision-reader';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import type { ScannedBranch } from './branch-page-reader';

export interface ScannedBranchRevisions extends HeadAndDraft {
  readonly historyRevisionIds: readonly string[];
}

export interface ScannedRevision {
  readonly revisionId: string;
  readonly tableVersionIds: ReadonlyMap<string, string>;
  readonly schemaTableVersionId?: string;
  readonly migrationTable?: StoredTableVersion;
}

export interface RowHashCount {
  readonly hash: string;
  readonly rowCount: number;
}

@Injectable()
export class ScanRevisionReader {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly revisionReader: BranchRevisionReader,
  ) {}

  private get client() {
    return this.transactionService.getTransactionOrPrisma();
  }

  public async readBranchRevisions(
    branch: ScannedBranch,
  ): Promise<ScannedBranchRevisions> {
    return {
      ...(await this.revisionReader.resolveHeadAndDraft(branch)),
      historyRevisionIds: await this.readHistoryRevisionIds(branch.id),
    };
  }

  public async readRevision(revisionId: string): Promise<ScannedRevision> {
    return scannedRevisionOf(
      revisionId,
      await this.revisionReader.readTables(revisionId),
    );
  }

  public async readRevisions(
    revisionIds: readonly string[],
  ): Promise<ScannedRevision[]> {
    const tablesByRevision =
      await this.revisionReader.readTablesOfRevisions(revisionIds);

    return revisionIds.map((revisionId) =>
      scannedRevisionOf(revisionId, tablesByRevision.get(revisionId) ?? []),
    );
  }

  public readTableRows(tableVersionId: string): Promise<Row[]> {
    return this.client.row.findMany({
      where: { tables: { some: { versionId: tableVersionId } } },
    });
  }

  public readRowHashes(tableVersionId: string): Promise<RowHashCount[]> {
    return this.client.$queryRaw<RowHashCount[]>(sql`
      SELECT r."schemaHash" AS "hash", count(*)::int AS "rowCount"
      FROM "_RowToTable" rt
      JOIN "Row" r ON r."versionId" = rt."A"
      WHERE rt."B" = ${tableVersionId}
      GROUP BY r."schemaHash"
      ORDER BY r."schemaHash" COLLATE "C"
    `);
  }

  public async hasActiveMigration(revisionId: string): Promise<boolean> {
    const activeMigrations = await this.client.tableMigration.count({
      where: { revisionId, status: { in: [...ACTIVE_MIGRATION_STATUSES] } },
    });

    return activeMigrations > 0;
  }

  private async readHistoryRevisionIds(branchId: string): Promise<string[]> {
    const revisions = await this.client.revision.findMany({
      where: { branchId, isHead: false, isDraft: false },
      orderBy: { sequence: 'asc' },
      select: { id: true },
    });

    return revisions.map(({ id }) => id);
  }
}

function scannedRevisionOf(
  revisionId: string,
  tables: readonly StoredTable[],
): ScannedRevision {
  return {
    revisionId,
    tableVersionIds: userTableVersionIdsOf(tables),
    schemaTableVersionId: systemTableOf(tables, SystemTables.Schema)?.versionId,
    migrationTable: migrationTableOf(tables),
  };
}

function migrationTableOf(
  tables: readonly StoredTable[],
): StoredTableVersion | undefined {
  const table = systemTableOf(tables, SystemTables.Migration);

  if (!table) {
    return undefined;
  }

  return storedVersionOf(table);
}
