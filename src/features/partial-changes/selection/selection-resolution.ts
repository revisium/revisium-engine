import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type {
  HeadSchemaCheck,
  RefusalCode,
} from 'src/features/partial-changes/head-schema/head-schema-check';
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

export type RequiredReasonCode =
  | 'structureBoundData'
  | 'wholeRowUnit'
  | 'atomicValue'
  | 'referencedRowMissing'
  | 'referrerStillReferences'
  | 'idOccupied';

export type BlockerCode =
  | 'notSelectable'
  | 'requiredExcluded'
  | 'danglingInSource'
  | 'unmatchedSelector'
  | 'tooLarge'
  | 'unrecordedStructureChange'
  | RefusalCode;

export interface Reason {
  readonly code: RequiredReasonCode;
  readonly tableId: string;
  readonly rowId?: string;
  readonly path?: string;
  readonly because: string;
}

export interface PlanBlocker {
  readonly code: BlockerCode;
  readonly tableId?: string;
  readonly rowId?: string;
  readonly path?: string;
  readonly message: string;
  readonly unitKey?: string;
  readonly reason?: Reason;
}

export type UnmatchedSelection = SelectionItems & {
  readonly exclude?: SelectionItems;
};

export interface SelectionResolution {
  readonly selected: ReadonlySet<string>;
  readonly excluded: ReadonlySet<string>;
  readonly required: ReadonlyMap<string, Reason>;
  readonly blockers: readonly PlanBlocker[];
  readonly unmatched: UnmatchedSelection;
}
