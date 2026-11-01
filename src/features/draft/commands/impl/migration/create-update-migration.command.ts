import { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';

export class CreateUpdateMigrationCommand {
  constructor(
    public readonly data: {
      readonly revisionId: string;
      readonly tableId: string;
      readonly schema: JsonSchema;
      readonly patches: JsonPatch[];
      readonly migrationId?: string;
    },
  ) {}
}

export type CreateUpdateMigrationCommandData =
  CreateUpdateMigrationCommand['data'];
