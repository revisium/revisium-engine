export class AbortMigrationCommand {
  constructor(
    public readonly data: {
      revisionId: string;
      tableId: string;
    },
  ) {}
}
