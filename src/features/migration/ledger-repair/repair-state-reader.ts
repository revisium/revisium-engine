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
  readonly schemas: ReadonlyMap<string, StoredSchema>;
  readonly migrationRows: readonly Row[];
}

export interface RepairState {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly head: RevisionLedger;
  readonly draft: RevisionLedger;
}

interface RepairBranch {
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

  public async readUnlockedBranch({
    projectId,
    branchName,
  }: RepairBranch): Promise<RepairState> {
    const { id: branchId } = await this.shareQueries.findBranchInProjectOrThrow(
      projectId,
      branchName,
    );
    const head =
      await this.shareQueries.findHeadRevisionInBranchOrThrow(branchId);
    const draft =
      await this.shareQueries.findDraftRevisionInBranchOrThrow(branchId);
    await this.migrationLock.checkRevisionLock(draft.id);

    return {
      headRevisionId: head.id,
      draftRevisionId: draft.id,
      head: await this.readRevisionLedger(head.id),
      draft: await this.readRevisionLedger(draft.id),
    };
  }

  private async readRevisionLedger(
    revisionId: string,
  ): Promise<RevisionLedger> {
    const tables = await this.transaction.table.findMany({
      where: { revisions: { some: { id: revisionId } } },
      select: { id: true, versionId: true, system: true },
    });
    const schemaRows = await this.readSystemRows(tables, SystemTables.Schema);

    return {
      tableVersionIds: new Map(
        tables
          .filter(({ system }) => !system)
          .map(({ id, versionId }) => [id, versionId]),
      ),
      schemas: new Map(schemaRows.map((row) => [row.id, storedSchemaOf(row)])),
      migrationRows: await this.readSystemRows(tables, SystemTables.Migration),
    };
  }

  private readSystemRows(
    tables: readonly StoredTable[],
    tableId: SystemTables,
  ): Promise<Row[]> {
    const table = tables.find(({ id, system }) => system && id === tableId);

    if (!table) {
      return Promise.resolve([]);
    }

    return this.transaction.row.findMany({
      where: { tables: { some: { versionId: table.versionId } } },
    });
  }
}

function storedSchemaOf(row: Row): StoredSchema {
  const history = Array.isArray(row.meta) ? row.meta : [];

  return {
    schema: row.data as unknown as JsonSchema,
    history: history as unknown as HistoryPatches[],
  };
}
