export interface CleanupProjectFileUsageCommandData {
  projectId: string;
}

export class CleanupProjectFileUsageCommand {
  constructor(public readonly data: CleanupProjectFileUsageCommandData) {}
}
