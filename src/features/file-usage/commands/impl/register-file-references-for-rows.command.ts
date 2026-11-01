import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { InputJsonValue } from 'src/engine-prisma-types';

export interface RegisterFileReferencesRowInput {
  rowId: string;
  rowVersionId: string;
  data: InputJsonValue;
}

export interface RegisterFileReferencesForRowsCommandData {
  revisionId: string;
  tableId: string;
  tableSchema?: JsonSchema;
  rows: readonly RegisterFileReferencesRowInput[];
}

export class RegisterFileReferencesForRowsCommand {
  constructor(public readonly data: RegisterFileReferencesForRowsCommandData) {}
}
