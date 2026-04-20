export interface GetProjectStorageBytesQueryData {
  projectId: string;
}

export class GetProjectStorageBytesQuery {
  constructor(public readonly data: GetProjectStorageBytesQueryData) {}
}
