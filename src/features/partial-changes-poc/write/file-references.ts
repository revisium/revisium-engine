import { TargetTable } from 'src/features/partial-changes-poc/assembly/target.types';
import { schemaUsesFiles } from 'src/features/partial-changes-poc/write/schema-files';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';

export interface RowsWithFiles {
  tableId: string;
  rowVersionIds: string[];
}

export function rowsWithFiles(
  target: TargetTable,
  rowVersionIds: string[],
): RowsWithFiles[] {
  if (
    target.table.kind === 'system' ||
    rowVersionIds.length === 0 ||
    !schemaUsesFiles(target.schema)
  ) {
    return [];
  }
  return [{ tableId: target.publicId ?? target.table.tableId, rowVersionIds }];
}

export async function registerFileReferences(
  fileUsage: FileUsageIntegrationService,
  revisionId: string,
  rows: readonly RowsWithFiles[],
): Promise<void> {
  for (const { tableId, rowVersionIds } of rows) {
    await fileUsage.registerReferencesForRowVersions({
      revisionId,
      tableId,
      rowVersionIds,
    });
  }
}
