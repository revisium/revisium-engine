export interface CleanupFileBlobsByIdsCommandData {
  projectId: string;
  blobIds: readonly string[];
}

export class CleanupFileBlobsByIdsCommand {
  constructor(public readonly data: CleanupFileBlobsByIdsCommandData) {}
}
