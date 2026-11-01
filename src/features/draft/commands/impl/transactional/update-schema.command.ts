import { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';

export class UpdateSchemaCommand {
  constructor(
    public readonly data: {
      revisionId: string;
      tableId: string;
      schema: JsonSchema;
      patches: JsonPatch[];
      migrationId?: string;
      skipCreatingMigration?: boolean;
      dryRun?: boolean;
    },
  ) {}
}
