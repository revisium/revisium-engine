import type { Branch, Table } from 'src/engine-prisma-types';

export type ApiCreateTableHandlerReturnType = {
  branch: Branch;
  table: Table;
};
