export class GetMigrationStatusQuery {
  constructor(
    public readonly data: {
      revisionId: string;
      tableId: string;
    },
  ) {}
}
