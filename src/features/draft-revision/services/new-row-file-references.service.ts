import { Injectable } from '@nestjs/common';
import type { TableWritePlan } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type {
  AssembledTableVersion,
  WrittenVersion,
} from 'src/features/draft-revision/services/assembled-version-writer.service';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface WrittenTable {
  readonly plan: TableWritePlan;
  readonly written: WrittenVersion;
}

@Injectable()
export class NewRowFileReferences {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly fileUsageIntegration: FileUsageIntegrationService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  public async register(
    revisionId: string,
    tables: readonly WrittenTable[],
  ): Promise<void> {
    for (const version of newVersionsWithFiles(tables)) {
      await this.fileUsageIntegration.registerReferencesForRowVersions({
        revisionId,
        tableId: await this.publicIdOf(version.versionId),
        rowVersionIds: version.newRowVersionIds,
      });
    }
  }

  private async publicIdOf(tableVersionId: string): Promise<string> {
    const { id } = await this.transaction.table.findUniqueOrThrow({
      where: { versionId: tableVersionId },
      select: { id: true },
    });

    return id;
  }
}

function newVersionsWithFiles(
  tables: readonly WrittenTable[],
): AssembledTableVersion[] {
  return tables.flatMap(({ plan, written }) => {
    const { versionId, newRowVersionIds } = written;

    if (
      !plan.hasFileFields ||
      versionId === undefined ||
      newRowVersionIds.length === 0
    ) {
      return [];
    }

    return [{ versionId, newRowVersionIds }];
  });
}
