import type { Unit } from 'src/features/partial-changes/catalogue/unit';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { UnitRef } from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';

export interface ListChangesInput {
  readonly branch: ChangesBranch;
  readonly tableId?: string;
  readonly cursor?: string;
  readonly pageSize?: number;
}

export type ListedUnit = UnitRef & { readonly structure?: Unit };

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
