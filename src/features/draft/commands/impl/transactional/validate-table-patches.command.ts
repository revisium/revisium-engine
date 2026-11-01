import type { JsonPatch } from '@revisium/schema-toolkit/types';

export class ValidateTablePatchesCommand {
  constructor(
    public readonly tableId: string,
    public readonly patches: JsonPatch[],
  ) {}
}
