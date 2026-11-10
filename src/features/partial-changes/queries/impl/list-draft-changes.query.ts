import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type {
  DescribedUnitRef,
  UnitRef,
} from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { AnnotationKeyword } from 'src/features/partial-changes/structure/normalized-leaf-schema';
import type { StructureFieldChange } from 'src/features/partial-changes/structure/table-structure';

export interface ListChangesInput {
  readonly branch: ChangesBranch;
  readonly tableId?: string | null;
  readonly cursor?: string | null;
  readonly pageSize?: number | null;
}

export const STRUCTURE_TABLE_CHANGES = [
  'created',
  'removed',
  'replaced',
  'transient',
  'changed',
] as const;

export type StructureTableChange = (typeof STRUCTURE_TABLE_CHANGES)[number];

export interface ChangedField {
  readonly path: string;
  readonly change: StructureFieldChange;
  readonly from?: string;
  readonly annotations?: readonly AnnotationKeyword[];
}

export interface StructureChange {
  readonly table: StructureTableChange;
  readonly fields: readonly ChangedField[];
  readonly views: boolean;
}

export type ListedUnit = DescribedUnitRef & {
  readonly structure?: UnitRef;
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
