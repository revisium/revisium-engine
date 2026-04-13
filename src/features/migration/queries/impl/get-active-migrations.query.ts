export class GetActiveMigrationsQuery {
  constructor(
    public readonly data: {
      revisionId: string;
    },
  ) {}
}
