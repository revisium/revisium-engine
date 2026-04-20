export interface GetStorageBytesForProjectsQueryData {
  projectIds: readonly string[];
}

export class GetStorageBytesForProjectsQuery {
  constructor(public readonly data: GetStorageBytesForProjectsQueryData) {}
}
