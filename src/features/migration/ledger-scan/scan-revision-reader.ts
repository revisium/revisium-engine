import { Injectable } from '@nestjs/common';
import { type Row, sql } from 'src/engine-prisma-types';
import { ACTIVE_MIGRATION_STATUSES } from 'src/features/migration/types/migration.types';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface BranchRevisions {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly historyRevisionIds: readonly string[];
}

export interface RevisionTables {
  readonly revisionId: string;
  readonly tableVersionIds: ReadonlyMap<string, string>;
  readonly schemaTableVersionId?: string;
  readonly migrationTableVersionId?: string;
}

export interface RowHashCount {
  readonly hash: string;
  readonly rowCount: number;
}

interface LinkedTable {
  readonly revisionId: string;
  readonly id: string;
  readonly versionId: string;
  readonly system: boolean;
}

@Injectable()
export class ScanRevisionReader {
  constructor(private readonly transactionService: TransactionPrismaService) {}

  private get client() {
    return this.transactionService.getTransactionOrPrisma();
  }

  public async readBranchRevisions(branchId: string): Promise<BranchRevisions> {
    const revisions = await this.client.revision.findMany({
      where: { branchId },
      orderBy: { sequence: 'asc' },
      select: { id: true, isHead: true, isDraft: true },
    });
    const head = revisions.find(({ isHead }) => isHead);
    const draft = revisions.find(({ isDraft }) => isDraft);

    if (!head || !draft) {
      throw new Error(`Branch "${branchId}" has no Head or Draft revision`);
    }

    return {
      headRevisionId: head.id,
      draftRevisionId: draft.id,
      historyRevisionIds: revisions
        .filter(({ isHead, isDraft }) => !isHead && !isDraft)
        .map(({ id }) => id),
    };
  }

  public async readRevision(revisionId: string): Promise<RevisionTables> {
    return revisionTablesOf(revisionId, await this.readLinks([revisionId]));
  }

  public async readRevisions(
    revisionIds: readonly string[],
  ): Promise<RevisionTables[]> {
    const linksByRevision = groupedByRevision(
      await this.readLinks(revisionIds),
    );

    return revisionIds.map((revisionId) =>
      revisionTablesOf(revisionId, linksByRevision.get(revisionId) ?? []),
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

  private readLinks(revisionIds: readonly string[]): Promise<LinkedTable[]> {
    return this.client.$queryRaw<LinkedTable[]>(sql`
      SELECT rt."A" AS "revisionId", t."id", t."versionId", t."system"
      FROM "_RevisionToTable" rt
      JOIN "Table" t ON t."versionId" = rt."B"
      WHERE rt."A" = ANY(${[...revisionIds]}::text[])
    `);
  }
}

function groupedByRevision(
  links: readonly LinkedTable[],
): Map<string, LinkedTable[]> {
  const linksByRevision = new Map<string, LinkedTable[]>();

  for (const link of links) {
    const revisionLinks = linksByRevision.get(link.revisionId) ?? [];
    revisionLinks.push(link);
    linksByRevision.set(link.revisionId, revisionLinks);
  }

  return linksByRevision;
}

function revisionTablesOf(
  revisionId: string,
  links: readonly LinkedTable[],
): RevisionTables {
  return {
    revisionId,
    tableVersionIds: new Map(
      links
        .filter(({ system }) => !system)
        .map(({ id, versionId }) => [id, versionId]),
    ),
    schemaTableVersionId: systemTableVersionIdOf(links, SystemTables.Schema),
    migrationTableVersionId: systemTableVersionIdOf(
      links,
      SystemTables.Migration,
    ),
  };
}

function systemTableVersionIdOf(
  links: readonly LinkedTable[],
  tableId: SystemTables,
): string | undefined {
  return links.find(({ id, system }) => system && id === tableId)?.versionId;
}
