import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
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
  readonly readonly: boolean;
  readonly schema: JsonSchema;
  readonly history: readonly HistoryPatches[];
}

export interface TablePair {
  readonly identity: string;
  readonly head?: TableVersion;
  readonly draft?: TableVersion;
}

export function publicTableIdOf({ identity, head, draft }: TablePair): string {
  return versionOf(identity, draft ?? head).id;
}

export interface RevisionRows {
  readonly head: readonly Row[];
  readonly draft: readonly Row[];
}

export interface SystemTableVersionIds {
  readonly head?: string;
  readonly draft?: string;
}

export interface SystemTableRows extends RevisionRows {
  readonly versionIds: SystemTableVersionIds;
}

export interface SystemRows {
  readonly schemas: SystemTableRows;
  readonly migrations: SystemTableRows;
  readonly views: SystemTableRows;
  readonly sharedSchemas: SystemTableRows;
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

export function hasDifferentVersions(table: ComparedTable): boolean {
  return table.headVersionId !== table.draftVersionId;
}

export interface RowPair {
  readonly identity: string;
  readonly head?: Row;
  readonly draft?: Row;
}

export type ChangedRows = ReadonlyMap<string, readonly RowPair[]>;

export function unitRowIdOf({ identity, head, draft }: RowPair): string {
  const row = draft ?? head;

  if (!row) {
    throw new Error(`Row ${identity} is in neither revision`);
  }

  return row.id;
}

interface Version {
  readonly id: string;
}

interface VersionPair<T extends Version> {
  readonly identity: string;
  readonly head?: T;
  readonly draft?: T;
}

export function versionOn<T extends Version>(
  pair: VersionPair<T>,
  side: RevisionSide,
): T {
  const version = pair[side];

  if (!version) {
    throw new Error(`${publicIdOrIdentityOf(pair)} has no ${side} version`);
  }

  return version;
}

export function publicIdOrIdentityOf({
  identity,
  head,
  draft,
}: VersionPair<Version>): string {
  return draft?.id ?? head?.id ?? identity;
}

export interface RowBound {
  readonly rowId: string;
  readonly inclusive: boolean;
}

export interface ChangedRowsKeyset {
  readonly from?: RowBound;
  readonly rowLimit: number;
}

function versionOf(
  identity: string,
  version: TableVersion | undefined,
): TableVersion {
  if (!version) {
    throw new Error(`Table ${identity} is in neither revision`);
  }

  return version;
}
