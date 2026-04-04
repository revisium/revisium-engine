import type { InputJsonValue } from 'src/engine-prisma-types';
import { JsonSchema } from '@revisium/schema-toolkit/types';

export interface InternalUpdateRowsCommandReturnType {
  tableVersionId: string;
  previousTableVersionId: string;
}

export class InternalUpdateRowsCommand {
  constructor(
    public readonly data: {
      revisionId: string;
      tableId: string;
      tableSchema: JsonSchema;
      schemaHash: string;
      rows: {
        rowId: string;
        data: InputJsonValue;
      }[];
    },
  ) {}
}
