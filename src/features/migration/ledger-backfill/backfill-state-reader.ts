import { Injectable } from '@nestjs/common';
import type { Row } from 'src/engine-prisma-types';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import {
  type BranchRef,
  BranchRevisionReader,
  type HeadAndDraft,
  type StoredTable,
  systemTableOf,
} from 'src/features/share/branch-revisions/branch-revision-reader';
import { SystemTables } from 'src/features/share/system-tables.consts';

export interface BackfillRevision {
  readonly userTables: readonly StoredTable[];
  readonly schemaRows: ReadonlyMap<string, Row>;
  readonly hasMigrationTable: boolean;
}

export interface BackfillState extends HeadAndDraft {
  readonly head: BackfillRevision;
  readonly draft: BackfillRevision;
}

@Injectable()
export class BackfillStateReader {
  constructor(
    private readonly revisionReader: BranchRevisionReader,
    private readonly migrationLock: MigrationLockService,
  ) {}

  public async readUnlockedBranch(branch: BranchRef): Promise<BackfillState> {
    const revisions = await this.revisionReader.resolveHeadAndDraft(branch);
    await this.migrationLock.checkRevisionLock(revisions.draftRevisionId);

    return {
      ...revisions,
      head: await this.readRevision(revisions.headRevisionId),
      draft: await this.readRevision(revisions.draftRevisionId),
    };
  }

  private async readRevision(revisionId: string): Promise<BackfillRevision> {
    const tables = await this.revisionReader.readTables(revisionId);
    const systemTables = await this.revisionReader.readSystemRows(tables, [
      SystemTables.Schema,
    ]);

    return {
      userTables: tables.filter(({ system }) => !system),
      schemaRows: new Map(
        systemTables[SystemTables.Schema].rows.map((row) => [row.id, row]),
      ),
      hasMigrationTable:
        systemTableOf(tables, SystemTables.Migration) !== undefined,
    };
  }
}
