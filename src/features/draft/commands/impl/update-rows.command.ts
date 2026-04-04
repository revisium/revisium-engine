import type { InputJsonValue } from 'src/engine-prisma-types';

export interface UpdateRowsRowInput {
  rowId: string;
  data: InputJsonValue;
}

export class UpdateRowsCommand {
  constructor(
    public readonly data: {
      revisionId: string;
      tableId: string;
      rows: UpdateRowsRowInput[];
      isRestore?: boolean;
    },
  ) {}
}

export type UpdateRowsCommandData = UpdateRowsCommand['data'];
