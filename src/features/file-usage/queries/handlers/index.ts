import { GetProjectStorageBytesHandler } from 'src/features/file-usage/queries/handlers/get-project-storage-bytes.handler';
import { GetStorageBytesForProjectsHandler } from 'src/features/file-usage/queries/handlers/get-storage-bytes-for-projects.handler';
import { GetPendingStorageDeletionsHandler } from 'src/features/file-usage/queries/handlers/get-pending-storage-deletions.handler';
import { ValidateProjectFileBytesHandler } from 'src/features/file-usage/queries/handlers/validate-project-file-bytes.handler';

export const FILE_USAGE_QUERY_HANDLERS = [
  GetProjectStorageBytesHandler,
  GetStorageBytesForProjectsHandler,
  GetPendingStorageDeletionsHandler,
  ValidateProjectFileBytesHandler,
];
