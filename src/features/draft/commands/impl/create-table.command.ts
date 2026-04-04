import type { InputJsonValue } from 'src/engine-prisma-types';

export class CreateTableCommand {
  constructor(
    public data: {
      revisionId: string;
      tableId: string;
      schema: InputJsonValue;
    },
  ) {}
}

export type CreateTableCommandData = CreateTableCommand['data'];
