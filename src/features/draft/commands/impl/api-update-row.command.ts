import type { InputJsonValue } from 'src/engine-prisma-types';

export class ApiUpdateRowCommand {
  constructor(
    public readonly data: {
      data: InputJsonValue;
      revisionId: string;
      tableId: string;
      rowId: string;
      skipCheckingNotSystemTable?: boolean;
      isRestore?: boolean;
    },
  ) {}
}

export type ApiUpdateRowCommandData = ApiUpdateRowCommand['data'];
