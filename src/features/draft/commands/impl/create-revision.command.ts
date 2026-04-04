export class CreateRevisionCommand {
  constructor(
    public data: {
      projectId: string;
      branchName: string;
      comment?: string;
    },
  ) {}
}
