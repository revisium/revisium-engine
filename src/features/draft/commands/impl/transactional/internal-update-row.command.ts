import type { InputJsonValue } from 'src/engine-prisma-types';

export class InternalUpdateRowCommand {
  constructor(
    public readonly data: {
      data: InputJsonValue;
      revisionId: string;
      tableId: string;
      rowId: string;
      schemaHash: string;
      meta?: InputJsonValue;
      publishedAt?: string;
    },
  ) {}
}

export type InternalUpdateRowCommandReturnType = {
  tableVersionId: string;
  previousTableVersionId: string;
  rowVersionId: string;
  previousRowVersionId: string;
};
