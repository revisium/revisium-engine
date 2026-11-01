import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';

export class ValidateTableUpdateCommand {
  constructor(
    public readonly data: {
      readonly revisionId: string;
      readonly tableId: string;
      readonly patches: JsonPatch[];
    },
  ) {}
}

export type ValidateTableUpdateCommandReturnType = {
  targetSchema: JsonSchema;
};
