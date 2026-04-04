import type { InputJsonValue } from 'src/engine-prisma-types';

export class InternalCreateRowCommand {
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

export type InternalCreateRowCommandReturnType = {
  tableVersionId: string;
  previousTableVersionId: string;
  rowVersionId: string;
};
