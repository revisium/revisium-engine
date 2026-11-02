import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { UnitRef } from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { FieldChange } from 'src/features/partial-changes/structure/table-structure';

export interface ListChangesInput {
  readonly branch: ChangesBranch;
  readonly tableId?: string | null;
  readonly cursor?: string | null;
  readonly pageSize?: number | null;
}

export const TABLE_CHANGES = [
  'created',
  'removed',
  'replaced',
  'transient',
  'changed',
] as const;

export type TableChange = (typeof TABLE_CHANGES)[number];

export interface ChangedField {
  readonly path: string;
  readonly change: FieldChange;
}

export interface StructureChange {
  readonly table: TableChange;
  readonly fields: readonly ChangedField[];
}

export type ListedUnit = UnitRef & {
  readonly structure?: UnitRef;
  readonly structureChange?: StructureChange;
};

export interface ListChangesResult {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly units: readonly ListedUnit[];
  readonly nextCursor: string | null;
  readonly refusedTables: readonly RefusedTable[];
}

export class ListDraftChangesQuery {
  constructor(public readonly data: ListChangesInput) {}
}
