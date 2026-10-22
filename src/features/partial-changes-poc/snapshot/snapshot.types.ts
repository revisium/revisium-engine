import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { TableStructure } from 'src/features/partial-changes-poc/structure/table-structure';

export type RevisionSide = 'head' | 'draft';

export interface TableVersion {
  versionId: string;
  createdId: string;
  id: string;
  readonly: boolean;
  system: boolean;
  createdAt: Date;
}

export interface RowVersion {
  versionId: string;
  createdId: string;
  id: string;
  readonly: boolean;
  data: unknown;
  meta: unknown;
  hash: string;
  schemaHash: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date;
}

export interface RowPair {
  createdId: string;
  head?: RowVersion;
  draft?: RowVersion;
}

export interface TablePair {
  createdId: string;
  head?: TableVersion;
  draft?: TableVersion;
  changedRows: RowPair[];
  headSchema?: JsonSchema;
  draftSchema?: JsonSchema;
  structure?: TableStructure;
}

export interface SideRows {
  head: RowVersion[];
  draft: RowVersion[];
}

export interface SystemRows {
  schemas: SideRows;
  migrations: SideRows;
  views: SideRows;
  shared: SideRows;
}

export interface ChangesSnapshot {
  branchId: string;
  projectId: string;
  headRevisionId: string;
  draftRevisionId: string;
  tables: TablePair[];
  system: SystemRows;
  changedRowCount: number;
  oversized: boolean;
}

export function sideOf<T>(
  pair: { head?: T; draft?: T },
  side: RevisionSide,
): T | undefined {
  return side === 'head' ? pair.head : pair.draft;
}

export function oppositeOf(side: RevisionSide): RevisionSide {
  return side === 'head' ? 'draft' : 'head';
}
