import { JsonPatch } from '@revisium/schema-toolkit/types';

export class StartAsyncMigrationCommand {
  constructor(
    public readonly data: {
      revisionId: string;
      tableId: string;
      patches: JsonPatch[];
    },
  ) {}
}
