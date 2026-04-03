export class GetBranchQuery {
  constructor(
    public data: {
      readonly projectId: string;
      readonly branchName: string;
    },
  ) {}
}

export type GetBranchQueryData = GetBranchQuery['data'];
