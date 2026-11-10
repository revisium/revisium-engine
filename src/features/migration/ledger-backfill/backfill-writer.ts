import { Injectable } from '@nestjs/common';
import type { InputJsonValue } from 'src/engine-prisma-types';
import type {
  CommitTableWritePlan,
  DraftRevisionCommitToTargetCommandReturnType,
  DraftRevisionCreateRowsRowData,
} from 'src/features/draft-revision/commands/impl';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { publishedAtOf } from 'src/features/share/ledger/native-migration-id';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { SystemTablesService } from 'src/features/share/system-tables.service';
import type { BackfillMigration } from './backfill-migrations';
import type { BackfillState } from './backfill-state-reader';

export type CommittedBackfill = DraftRevisionCommitToTargetCommandReturnType;

@Injectable()
export class BackfillWriter {
  constructor(
    private readonly systemTables: SystemTablesService,
    private readonly draftRevisionApi: DraftRevisionApiService,
    private readonly targetApi: DraftRevisionTargetApiService,
    private readonly validator: JsonSchemaValidatorService,
  ) {}

  // The migration table is created in the Draft and committed alone, so the new Head is the Head plus the ledger and
  // the new Draft links the same version (schema-ledger-backfill §3 step 6).
  public async write(
    { branchId, headRevisionId, draftRevisionId }: BackfillState,
    migrations: readonly BackfillMigration[],
    comment: string,
  ): Promise<CommittedBackfill> {
    await this.systemTables.ensureSystemTable(
      draftRevisionId,
      SystemTables.Migration,
    );

    const { tableVersionId } = await this.draftRevisionApi.createRows({
      revisionId: draftRevisionId,
      tableId: SystemTables.Migration,
      rows: migrations.map((migration) => this.migrationRowOf(migration)),
    });

    return this.targetApi.commitToTarget({
      branchId,
      headRevisionId,
      draftRevisionId,
      comment,
      tables: [migrationTableCommitOf(tableVersionId)],
    });
  }

  private migrationRowOf(
    migration: BackfillMigration,
  ): DraftRevisionCreateRowsRowData {
    return {
      rowId: migration.id,
      data: migration as unknown as InputJsonValue,
      schemaHash: this.validator.tableSchemaHash,
      publishedAt: publishedAtOf(migration.id),
    };
  }
}

function migrationTableCommitOf(versionId: string): CommitTableWritePlan {
  return {
    identity: SystemTables.Migration,
    draftVersionId: versionId,
    target: { kind: 'linked', versionId },
    relinkCandidate: false,
  };
}
