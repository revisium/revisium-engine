import type {
  CatalogueRow,
  CatalogueTable,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import type {
  RevisionSide,
  RowVersion,
  TableVersion,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';

export interface Direction {
  base: RevisionSide;
  other: RevisionSide;
}

export const COMMIT_DIRECTION: Direction = { base: 'head', other: 'draft' };
export const REVERT_DIRECTION: Direction = { base: 'draft', other: 'head' };

export type RowOutcome =
  | { kind: 'absent' }
  | { kind: 'base'; version: RowVersion }
  | { kind: 'other'; version: RowVersion }
  | {
      kind: 'merged';
      id: string;
      data: Record<string, unknown>;
      hash: string;
      base: RowVersion;
      idFromOther: boolean;
    };

export interface TargetRow {
  row: CatalogueRow;
  outcome: RowOutcome;
}

export type TableOutcome =
  | 'unchanged'
  | 'base'
  | 'other'
  | 'mixed'
  | 'mixedSystemUnsupported';

export interface TargetTable {
  table: CatalogueTable;
  outcome: TableOutcome;
  rows: TargetRow[];
}

export interface TargetState {
  direction: Direction;
  tables: TargetTable[];
}

export function outcomeId(outcome: RowOutcome): string | undefined {
  switch (outcome.kind) {
    case 'absent':
      return undefined;
    case 'merged':
      return outcome.id;
    default:
      return outcome.version.id;
  }
}

export function outcomeData(outcome: RowOutcome): unknown {
  switch (outcome.kind) {
    case 'absent':
      return undefined;
    case 'merged':
      return outcome.data;
    default:
      return outcome.version.data;
  }
}

export function targetTableVersion(
  target: TargetTable,
  direction: Direction,
): TableVersion | undefined {
  const { pair } = target.table;
  if (target.outcome === 'other') {
    return direction.other === 'head' ? pair.head : pair.draft;
  }
  return direction.base === 'head' ? pair.head : pair.draft;
}
