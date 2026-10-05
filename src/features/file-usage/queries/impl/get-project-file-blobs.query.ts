export interface GetProjectFileBlobsQueryData {
  projectId: string;
  hashes: readonly string[];
}

export interface ProjectFileBlobRecord {
  id: string;
  hash: string;
  size: bigint;
  deletedAt: Date | null;
}

export type GetProjectFileBlobsResult = ProjectFileBlobRecord[];

export class GetProjectFileBlobsQuery {
  constructor(public readonly data: GetProjectFileBlobsQueryData) {}
}
