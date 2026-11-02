import { Injectable } from '@nestjs/common';
import type { Row } from 'src/engine-prisma-types';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import {
  type BranchRef,
  BranchRevisionReader,
  type HeadAndDraft,
  userTableVersionIdsOf,
} from 'src/features/share/branch-revisions/branch-revision-reader';
import {
  schemaRowOf,
  type StoredSchema,
} from 'src/features/share/ledger/migration-ledger';
import { SystemTables } from 'src/features/share/system-tables.consts';

export interface RevisionLedger {
  readonly tableVersionIds: ReadonlyMap<string, string>;
  readonly migrationTableVersionId?: string;
  readonly schemas: ReadonlyMap<string, StoredSchema>;
  readonly migrationRows: readonly Row[];
}

export interface RepairState {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly head: RevisionLedger;
  readonly draft: RevisionLedger;
}

const LEDGER_SYSTEM_TABLES = [
  SystemTables.Schema,
  SystemTables.Migration,
] as const;

@Injectable()
export class RepairStateReader {
  constructor(
    private readonly revisionReader: BranchRevisionReader,
    private readonly migrationLock: MigrationLockService,
  ) {}

  public async readUnlockedBranch(branch: BranchRef): Promise<RepairState> {
    const revisions = await this.revisionReader.resolveHeadAndDraft(branch);
    await this.migrationLock.checkRevisionLock(revisions.draftRevisionId);

    return this.readLedgers(revisions);
  }

  public async readBranch(branch: BranchRef): Promise<RepairState> {
    return this.readLedgers(
      await this.revisionReader.resolveHeadAndDraft(branch),
    );
  }

  private async readLedgers({
    headRevisionId,
    draftRevisionId,
  }: HeadAndDraft): Promise<RepairState> {
    return {
      headRevisionId,
      draftRevisionId,
      head: await this.readRevisionLedger(headRevisionId),
      draft: await this.readRevisionLedger(draftRevisionId),
    };
  }

  private async readRevisionLedger(
    revisionId: string,
  ): Promise<RevisionLedger> {
    const tables = await this.revisionReader.readTables(revisionId);
    const systemTables = await this.revisionReader.readSystemRows(
      tables,
      LEDGER_SYSTEM_TABLES,
    );
    const migrationTable = systemTables[SystemTables.Migration];

    return revisionLedgerOf(
      userTableVersionIdsOf(tables),
      systemTables[SystemTables.Schema].rows,
      migrationTable.rows,
      migrationTable.versionId,
    );
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
    schemas: new Map(schemaRows.map((row) => [row.id, schemaRowOf(row)])),
    migrationRows,
  };
}
