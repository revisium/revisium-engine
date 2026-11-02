import { Injectable } from '@nestjs/common';
import type { TableWritePlan } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { WrittenVersion } from 'src/features/draft-revision/services/assembled-version-writer.service';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';

export interface WrittenTable {
  readonly plan: TableWritePlan;
  readonly written: WrittenVersion;
}

interface NewRowsWithFiles {
  readonly tableId: string;
  readonly rowVersionIds: readonly string[];
}

@Injectable()
export class NewRowFileReferences {
  constructor(
    private readonly fileUsageIntegration: FileUsageIntegrationService,
  ) {}

  public async register(
    revisionId: string,
    tables: readonly WrittenTable[],
  ): Promise<void> {
    for (const { tableId, rowVersionIds } of newRowsWithFilesOf(tables)) {
      await this.fileUsageIntegration.registerReferencesForRowVersions({
        revisionId,
        tableId,
        rowVersionIds,
      });
    }
  }
}

function newRowsWithFilesOf(
  tables: readonly WrittenTable[],
): NewRowsWithFiles[] {
  return tables.flatMap(({ plan: { target }, written }) => {
    if (
      target.kind !== 'mixed' ||
      !target.hasFileFields ||
      written.newRowVersionIds.length === 0
    ) {
      return [];
    }

    return [
      { tableId: target.tableId, rowVersionIds: written.newRowVersionIds },
    ];
  });
}
