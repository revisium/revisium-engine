import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import {
  DraftRevisionCommitCommand,
  DraftRevisionCommitCommandData,
  DraftRevisionCommitCommandReturnType,
  DraftRevisionCreateRowsCommand,
  DraftRevisionCreateRowsCommandData,
  DraftRevisionCreateRowsCommandReturnType,
  DraftRevisionCreateTableCommand,
  DraftRevisionCreateTableCommandData,
  DraftRevisionCreateTableCommandReturnType,
  DraftRevisionRemoveRowsCommand,
  DraftRevisionRemoveRowsCommandData,
  DraftRevisionRemoveRowsCommandReturnType,
  DraftRevisionRemoveTableCommand,
  DraftRevisionRemoveTableCommandData,
  DraftRevisionRemoveTableCommandReturnType,
  DraftRevisionRenameRowsCommand,
  DraftRevisionRenameRowsCommandData,
  DraftRevisionRenameRowsCommandReturnType,
  DraftRevisionRenameTableCommand,
  DraftRevisionRenameTableCommandData,
  DraftRevisionRenameTableCommandReturnType,
  DraftRevisionRevertCommand,
  DraftRevisionRevertCommandData,
  DraftRevisionRevertCommandReturnType,
  DraftRevisionUpdateRowsCommand,
  DraftRevisionUpdateRowsCommandData,
  DraftRevisionUpdateRowsCommandReturnType,
} from 'src/features/draft-revision/commands/impl';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';

@Injectable()
export class DraftRevisionApiService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly fileUsageIntegration: FileUsageIntegrationService,
  ) {}

  public createTable(
    data: DraftRevisionCreateTableCommandData,
  ): Promise<DraftRevisionCreateTableCommandReturnType> {
    return this.commandBus.execute(new DraftRevisionCreateTableCommand(data));
  }

  public removeTable(
    data: DraftRevisionRemoveTableCommandData,
  ): Promise<DraftRevisionRemoveTableCommandReturnType> {
    return this.commandBus.execute(new DraftRevisionRemoveTableCommand(data));
  }

  public renameTable(
    data: DraftRevisionRenameTableCommandData,
  ): Promise<DraftRevisionRenameTableCommandReturnType> {
    return this.commandBus.execute(new DraftRevisionRenameTableCommand(data));
  }

  public async createRows(
    data: DraftRevisionCreateRowsCommandData,
  ): Promise<DraftRevisionCreateRowsCommandReturnType> {
    const result: DraftRevisionCreateRowsCommandReturnType =
      await this.commandBus.execute(new DraftRevisionCreateRowsCommand(data));

    await this.fileUsageIntegration.registerReferencesForRows({
      revisionId: data.revisionId,
      tableId: data.tableId,
      rows: data.rows.map((row, index) => ({
        rowId: row.rowId,
        rowVersionId: result.createdRows[index]?.rowVersionId ?? '',
        data: row.data,
      })),
    });

    return result;
  }

  public async updateRows(
    data: DraftRevisionUpdateRowsCommandData,
  ): Promise<DraftRevisionUpdateRowsCommandReturnType> {
    const result: DraftRevisionUpdateRowsCommandReturnType =
      await this.commandBus.execute(new DraftRevisionUpdateRowsCommand(data));

    await this.fileUsageIntegration.registerReferencesForRows({
      revisionId: data.revisionId,
      tableId: data.tableId,
      rows: data.rows.map((row, index) => ({
        rowId: row.rowId,
        rowVersionId: result.updatedRows[index]?.rowVersionId ?? '',
        data: row.data,
      })),
    });

    return result;
  }

  public async renameRows(
    data: DraftRevisionRenameRowsCommandData,
  ): Promise<DraftRevisionRenameRowsCommandReturnType> {
    const result: DraftRevisionRenameRowsCommandReturnType =
      await this.commandBus.execute(new DraftRevisionRenameRowsCommand(data));

    await this.fileUsageIntegration.registerReferencesForRowVersions({
      revisionId: data.revisionId,
      tableId: data.tableId,
      rowVersionIds: result.renamedRows.map((row) => row.rowVersionId),
    });

    return result;
  }

  public async removeRows(
    data: DraftRevisionRemoveRowsCommandData,
  ): Promise<DraftRevisionRemoveRowsCommandReturnType> {
    const affectedBlobIds =
      await this.fileUsageIntegration.findBlobIdsLinkedToRows({
        tableId: data.tableId,
        rowIds: data.rowIds,
      });

    const result: DraftRevisionRemoveRowsCommandReturnType =
      await this.commandBus.execute(new DraftRevisionRemoveRowsCommand(data));

    await this.fileUsageIntegration.cleanupBlobsByIds({
      revisionId: data.revisionId,
      blobIds: affectedBlobIds,
    });

    return result;
  }

  public commit(
    data: DraftRevisionCommitCommandData,
  ): Promise<DraftRevisionCommitCommandReturnType> {
    return this.commandBus.execute(new DraftRevisionCommitCommand(data));
  }

  public revert(
    data: DraftRevisionRevertCommandData,
  ): Promise<DraftRevisionRevertCommandReturnType> {
    return this.commandBus.execute(new DraftRevisionRevertCommand(data));
  }
}
