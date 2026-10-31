import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';
import type { HistoryPatches } from 'src/features/share/queries/impl';

export interface ChangesBranch {
  readonly projectId: string;
  readonly branchName: string;
}

export interface TableVersion {
  readonly versionId: string;
  readonly createdId: string;
  readonly id: string;
  readonly schema: JsonSchema;
  readonly history: readonly HistoryPatches[];
}

export interface TablePair {
  readonly identity: string;
  readonly head?: TableVersion;
  readonly draft?: TableVersion;
}

export interface RevisionRows {
  readonly head: readonly Row[];
  readonly draft: readonly Row[];
}

export interface SystemRows {
  readonly schemas: RevisionRows;
  readonly migrations: RevisionRows;
  readonly views: RevisionRows;
  readonly sharedSchemas: RevisionRows;
}

export interface BranchRevisions {
  readonly branchId: string;
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
}

export interface ChangesSnapshot extends BranchRevisions {
  readonly tables: readonly TablePair[];
  readonly systemRows: SystemRows;
}

export interface ComparedTable {
  readonly identity: string;
  readonly headVersionId: string;
  readonly draftVersionId: string;
  readonly structure: TableStructure;
}

export interface RowPair {
  readonly identity: string;
  readonly head?: Row;
  readonly draft?: Row;
}

export type ChangedRows = ReadonlyMap<string, readonly RowPair[]>;
