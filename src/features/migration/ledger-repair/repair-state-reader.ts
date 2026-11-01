import { Injectable } from '@nestjs/common';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface StoredSchema {
  readonly schema: JsonSchema;
  readonly history: readonly HistoryPatches[];
}

export interface RevisionLedger {
  readonly tableVersionIds: ReadonlyMap<string, string>;
  readonly migrationTableVersionId?: string;
  readonly schemas: ReadonlyMap<string, StoredSchema>;
  readonly migrationRows: readonly Row[];
}

interface RepairRevisions {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
}

export interface RepairState extends RepairRevisions {
  readonly head: RevisionLedger;
  readonly draft: RevisionLedger;
}

export interface RepairBranch {
  readonly projectId: string;
  readonly branchName: string;
}

interface StoredTable {
  readonly id: string;
  readonly versionId: string;
  readonly system: boolean;
}

@Injectable()
export class RepairStateReader {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly shareQueries: ShareTransactionalQueries,
    private readonly migrationLock: MigrationLockService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  public async readUnlockedBranch(branch: RepairBranch): Promise<RepairState> {
    const revisions = await this.readRevisions(branch);
    await this.migrationLock.checkRevisionLock(revisions.draftRevisionId);

    return this.readLedgers(revisions);
  }

  public async readBranch(branch: RepairBranch): Promise<RepairState> {
    return this.readLedgers(await this.readRevisions(branch));
  }

  private async readRevisions({
    projectId,
    branchName,
  }: RepairBranch): Promise<RepairRevisions> {
    const { id: branchId } = await this.shareQueries.findBranchInProjectOrThrow(
      projectId,
      branchName,
    );
    const head =
      await this.shareQueries.findHeadRevisionInBranchOrThrow(branchId);
    const draft =
      await this.shareQueries.findDraftRevisionInBranchOrThrow(branchId);

    return { headRevisionId: head.id, draftRevisionId: draft.id };
  }

  private async readLedgers(revisions: RepairRevisions): Promise<RepairState> {
    return {
      ...revisions,
      head: await this.readRevisionLedger(revisions.headRevisionId),
      draft: await this.readRevisionLedger(revisions.draftRevisionId),
    };
  }

  private async readRevisionLedger(
    revisionId: string,
  ): Promise<RevisionLedger> {
    const tables = await this.transaction.table.findMany({
      where: { revisions: { some: { id: revisionId } } },
      select: { id: true, versionId: true, system: true },
    });

    return revisionLedgerOf(
      new Map(
        tables
          .filter(({ system }) => !system)
          .map(({ id, versionId }) => [id, versionId]),
      ),
      await this.readSystemRows(tables, SystemTables.Schema),
      await this.readSystemRows(tables, SystemTables.Migration),
      systemTableOf(tables, SystemTables.Migration)?.versionId,
    );
  }

  private readSystemRows(
    tables: readonly StoredTable[],
    tableId: SystemTables,
  ): Promise<Row[]> {
    const table = systemTableOf(tables, tableId);

    if (!table) {
      return Promise.resolve([]);
    }

    return this.transaction.row.findMany({
      where: { tables: { some: { versionId: table.versionId } } },
    });
  }
}

export function revisionLedgerOf(
  tableVersionIds: ReadonlyMap<string, string>,
  schemaRows: readonly Row[],
  migrationRows: readonly Row[],
  migrationTableVersionId: string | undefined,
): RevisionLedger {
  return {
    tableVersionIds,
    migrationTableVersionId,
    schemas: new Map(schemaRows.map((row) => [row.id, storedSchemaOf(row)])),
    migrationRows,
  };
}

function systemTableOf(
  tables: readonly StoredTable[],
  tableId: SystemTables,
): StoredTable | undefined {
  return tables.find(({ id, system }) => system && id === tableId);
}

function storedSchemaOf(row: Row): StoredSchema {
  const history = Array.isArray(row.meta) ? row.meta : [];

  return {
    schema: row.data as unknown as JsonSchema,
    history: history as unknown as HistoryPatches[],
  };
}
