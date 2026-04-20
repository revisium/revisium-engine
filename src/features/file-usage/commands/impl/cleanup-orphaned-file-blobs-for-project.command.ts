export interface CleanupOrphanedFileBlobsForProjectCommandData {
  projectId: string;
}

export class CleanupOrphanedFileBlobsForProjectCommand {
  constructor(
    public readonly data: CleanupOrphanedFileBlobsForProjectCommandData,
  ) {}
}
