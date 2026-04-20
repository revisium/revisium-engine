export interface BackfillProjectFileBlobsCommandData {
  projectId: string;
  dryRun?: boolean;
}

export class BackfillProjectFileBlobsCommand {
  constructor(public readonly data: BackfillProjectFileBlobsCommandData) {}
}
