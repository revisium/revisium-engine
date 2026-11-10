import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type { HeadSchemaCheck } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { CatalogueBlocker } from 'src/features/partial-changes/plan/plan-blocker';
import type { CatalogueReason } from 'src/features/partial-changes/plan/reason';
import type { AddressedRows } from 'src/features/partial-changes/selection/addressed-rows';
import type { SelectionItems } from 'src/features/partial-changes/selection/selection';
import type {
  ChangesSnapshot,
  ComparedTable,
} from 'src/features/partial-changes/snapshot/changes-snapshot';

export interface SelectionSource {
  readonly snapshot: ChangesSnapshot;
  readonly headSchema: HeadSchemaCheck;
  readonly tables: readonly ComparedTable[];
  readonly catalogue: ChangeCatalogue;
  readonly addressedRows: AddressedRows;
}

export type UnmatchedSelectors = SelectionItems & {
  readonly exclude?: SelectionItems;
};

export function hasUnmatchedSelectors(unmatched: UnmatchedSelectors): boolean {
  return Object.keys(unmatched).length > 0;
}

export interface SelectionResolution {
  readonly selected: ReadonlySet<string>;
  readonly excluded: ReadonlySet<string>;
  readonly required: ReadonlyMap<string, CatalogueReason>;
  readonly blockers: readonly CatalogueBlocker[];
  readonly unmatched: UnmatchedSelectors;
}
