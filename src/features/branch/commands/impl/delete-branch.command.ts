export class DeleteBranchCommand {
  constructor(
    public data: {
      projectId: string;
      branchName: string;
    },
  ) {}
}

export type DeleteBranchCommandData = DeleteBranchCommand['data'];
