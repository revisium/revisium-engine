import type { InputJsonValue } from 'src/engine-prisma-types';

export interface CreateRowsRowInput {
  rowId: string;
  data: InputJsonValue;
}

export class CreateRowsCommand {
  constructor(
    public readonly data: {
      revisionId: string;
      tableId: string;
      rows: CreateRowsRowInput[];
      isRestore?: boolean;
    },
  ) {}
}

export type CreateRowsCommandData = CreateRowsCommand['data'];
