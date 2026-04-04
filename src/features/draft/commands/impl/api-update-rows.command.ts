import type { InputJsonValue } from 'src/engine-prisma-types';

export interface ApiUpdateRowsRowInput {
  rowId: string;
  data: InputJsonValue;
}

export class ApiUpdateRowsCommand {
  constructor(
    public readonly data: {
      revisionId: string;
      tableId: string;
      rows: ApiUpdateRowsRowInput[];
      isRestore?: boolean;
    },
  ) {}
}

export type ApiUpdateRowsCommandData = ApiUpdateRowsCommand['data'];
