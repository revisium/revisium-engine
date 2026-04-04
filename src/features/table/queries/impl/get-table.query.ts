import type { Table } from 'src/engine-prisma-types';

export class GetTableQuery {
  constructor(public data: { revisionId: string; tableId: string }) {}
}

export type GetTableQueryData = GetTableQuery['data'];

export type GetTableQueryReturnType = Table;
