export class RevertChangesCommand {
  constructor(
    public data: {
      projectId: string;
      branchName: string;
    },
  ) {}
}
