import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';

export class MigrateTableViewsCommand {
  constructor(
    public readonly data: {
      readonly revisionId: string;
      readonly tableId: string;
      readonly patches: JsonPatch[];
      readonly previousSchema: JsonSchema;
      readonly dryRun?: boolean;
    },
  ) {}
}
