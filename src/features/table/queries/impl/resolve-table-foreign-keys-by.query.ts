import type { Table } from 'src/engine-prisma-types';
import { IPaginatedType } from 'src/features/share/pagination.interface';

export class ResolveTableForeignKeysByQuery {
  constructor(
    public readonly data: {
      readonly revisionId: string;
      readonly tableId: string;
      readonly first: number;
      readonly after?: string;
    },
  ) {}
}

export type ResolveTableForeignKeysByQueryData =
  ResolveTableForeignKeysByQuery['data'];

export type ResolveTableForeignKeysByQueryReturnType = IPaginatedType<Table>;
