import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  BackfillProjectFileBlobsCommand,
  CleanupOrphanedFileBlobsCommand,
  CleanupOrphanedFileBlobsForProjectCommand,
  CleanupProjectFileUsageCommand,
  ConfirmStorageDeletedCommand,
  RestoreProjectFileBytesCommand,
} from 'src/features/file-usage/commands/impl';
import {
  GetPendingStorageDeletionsQuery,
  GetProjectStorageBytesQuery,
  GetStorageBytesForProjectsQuery,
  ValidateProjectFileBytesQuery,
} from 'src/features/file-usage/queries/impl';
import {
  BackfillProjectFileBlobsResult,
  CleanupOrphanedFileBlobsResult,
  CleanupProjectFileUsageResult,
  ConfirmStorageDeletedResult,
  PendingStorageDeletion,
  RestoreProjectFileBytesResult,
  ValidateProjectFileBytesResult,
} from 'src/features/file-usage/types';

@Injectable()
export class FileUsageApiService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  public getProjectStorageBytes(data: { projectId: string }): Promise<bigint> {
    return this.queryBus.execute(new GetProjectStorageBytesQuery(data));
  }

  public getStorageBytesForProjects(data: {
    projectIds: readonly string[];
  }): Promise<bigint> {
    return this.queryBus.execute(new GetStorageBytesForProjectsQuery(data));
  }

  public validateProjectFileBytes(data: {
    projectId: string;
  }): Promise<ValidateProjectFileBytesResult> {
    return this.queryBus.execute(new ValidateProjectFileBytesQuery(data));
  }

  public restoreProjectFileBytes(data: {
    projectId: string;
  }): Promise<RestoreProjectFileBytesResult> {
    return this.commandBus.execute(new RestoreProjectFileBytesCommand(data));
  }

  public backfillProjectFileBlobs(data: {
    projectId: string;
    dryRun?: boolean;
  }): Promise<BackfillProjectFileBlobsResult> {
    return this.commandBus.execute(new BackfillProjectFileBlobsCommand(data));
  }

  public cleanupOrphanedFileBlobs(): Promise<CleanupOrphanedFileBlobsResult> {
    return this.commandBus.execute(new CleanupOrphanedFileBlobsCommand());
  }

  public cleanupOrphanedFileBlobsForProject(data: {
    projectId: string;
  }): Promise<CleanupOrphanedFileBlobsResult> {
    return this.commandBus.execute(
      new CleanupOrphanedFileBlobsForProjectCommand(data),
    );
  }

  public cleanupProjectFileUsage(data: {
    projectId: string;
  }): Promise<CleanupProjectFileUsageResult> {
    return this.commandBus.execute(new CleanupProjectFileUsageCommand(data));
  }

  public getPendingStorageDeletions(data: {
    limit?: number;
    afterHash?: string;
  }): Promise<PendingStorageDeletion[]> {
    return this.queryBus.execute(new GetPendingStorageDeletionsQuery(data));
  }

  public confirmStorageDeleted(data: {
    hashes: readonly string[];
  }): Promise<ConfirmStorageDeletedResult> {
    return this.commandBus.execute(new ConfirmStorageDeletedCommand(data));
  }
}
