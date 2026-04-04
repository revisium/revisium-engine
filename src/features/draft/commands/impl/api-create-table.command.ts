import type { InputJsonValue } from 'src/engine-prisma-types';

export class ApiCreateTableCommand {
  constructor(
    public data: {
      revisionId: string;
      tableId: string;
      schema: InputJsonValue;
    },
  ) {}
}

export type ApiCreateTableCommandData = ApiCreateTableCommand['data'];
