import type { InputJsonValue } from 'src/engine-prisma-types';

export interface ApiCreateRowsRowInput {
  rowId: string;
  data: InputJsonValue;
}

export class ApiCreateRowsCommand {
  constructor(
    public readonly data: {
      revisionId: string;
      tableId: string;
      rows: ApiCreateRowsRowInput[];
      isRestore?: boolean;
    },
  ) {}
}

export type ApiCreateRowsCommandData = ApiCreateRowsCommand['data'];
