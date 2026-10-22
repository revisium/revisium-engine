import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type {
  CatalogueRow,
  CatalogueTable,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import type {
  Blocker,
  ChangeOperation,
} from 'src/features/partial-changes-poc/partial-changes.types';
import {
  oppositeOf,
  RevisionSide,
  RowVersion,
  sideOf,
  TableVersion,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import type { TableViewsData } from 'src/features/views/types';

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
      createdId: string;
      id: string;
      data: Record<string, unknown>;
      hash: string;
      schemaHash: string;
      metaSource: RowVersion;
    };

export interface TargetRow {
  row: CatalogueRow;
  outcome: RowOutcome;
}

export type TableOutcome = 'unchanged' | 'absent' | 'base' | 'other' | 'mixed';

export interface TargetTable {
  table: CatalogueTable;
  outcome: TableOutcome;
  linkSide: RevisionSide;
  publicId?: string;
  schema?: JsonSchema;
  structureSide?: RevisionSide;
  rows: TargetRow[];
}

export interface ViewsTarget {
  table: CatalogueTable;
  publicId: string;
  viewsSide: RevisionSide;
  structureSide: RevisionSide;
  doc?: TableViewsData;
}

export interface TargetState {
  operation: ChangeOperation;
  direction: Direction;
  tables: TargetTable[];
  views: ViewsTarget[];
  blockers: Blocker[];
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
): TableVersion | undefined {
  const { pair } = target.table;
  if (target.outcome === 'absent') {
    return undefined;
  }
  if (target.outcome === 'other') {
    return sideOf(pair, oppositeOf(target.linkSide));
  }
  return sideOf(pair, target.linkSide);
}
