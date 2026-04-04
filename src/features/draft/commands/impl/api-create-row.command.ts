import type { InputJsonValue } from 'src/engine-prisma-types';

export class ApiCreateRowCommand {
  constructor(
    public readonly data: {
      data: InputJsonValue;
      revisionId: string;
      tableId: string;
      rowId: string;
      isRestore?: boolean;
    },
  ) {}
}

export type ApiCreateRowCommandData = ApiCreateRowCommand['data'];
