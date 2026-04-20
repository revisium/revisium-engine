import { RestoreProjectFileBytesHandler } from 'src/features/file-usage/commands/handlers/restore-project-file-bytes.handler';
import { BackfillProjectFileBlobsHandler } from 'src/features/file-usage/commands/handlers/backfill-project-file-blobs.handler';
import { CleanupFileBlobsByIdsHandler } from 'src/features/file-usage/commands/handlers/cleanup-file-blobs-by-ids.handler';
import { CleanupOrphanedFileBlobsHandler } from 'src/features/file-usage/commands/handlers/cleanup-orphaned-file-blobs.handler';
import { CleanupOrphanedFileBlobsForProjectHandler } from 'src/features/file-usage/commands/handlers/cleanup-orphaned-file-blobs-for-project.handler';
import { CleanupProjectFileUsageHandler } from 'src/features/file-usage/commands/handlers/cleanup-project-file-usage.handler';
import { ConfirmStorageDeletedHandler } from 'src/features/file-usage/commands/handlers/confirm-storage-deleted.handler';
import { RegisterFileReferencesForRowsHandler } from 'src/features/file-usage/commands/handlers/register-file-references-for-rows.handler';
import { RegisterFileReferencesForRowVersionsHandler } from 'src/features/file-usage/commands/handlers/register-file-references-for-row-versions.handler';

export const FILE_USAGE_COMMAND_HANDLERS = [
  RestoreProjectFileBytesHandler,
  BackfillProjectFileBlobsHandler,
  CleanupFileBlobsByIdsHandler,
  CleanupOrphanedFileBlobsHandler,
  CleanupOrphanedFileBlobsForProjectHandler,
  CleanupProjectFileUsageHandler,
  ConfirmStorageDeletedHandler,
  RegisterFileReferencesForRowsHandler,
  RegisterFileReferencesForRowVersionsHandler,
];
