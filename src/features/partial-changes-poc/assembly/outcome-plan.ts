import { keepsNoUnits } from 'src/features/partial-changes-poc/assembly/remaining-units';
import type {
  Direction,
  TableOutcome,
} from 'src/features/partial-changes-poc/assembly/target.types';
import type {
  CatalogueRow,
  CatalogueTable,
  ChangeCatalogue,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import type { RowColumn } from 'src/features/partial-changes-poc/catalogue/row-columns';
import type { ChangeOperation } from 'src/features/partial-changes-poc/partial-changes.types';
import {
  oppositeOf,
  RevisionSide,
  RowVersion,
  sideOf,
  TablePair,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';

export interface OutcomeInput {
  catalogue: ChangeCatalogue;
  operation: ChangeOperation;
  direction: Direction;
  applied: ReadonlySet<string>;
  preferOtherForUnitlessTables: boolean;
}

export interface TablePlan {
  linkSide: RevisionSide;
  structureDiffers: boolean;
  takesOtherSide: (key: string) => boolean;
}

export interface RowFlips {
  base: RowVersion;
  other: RowVersion;
  renameFlips: boolean;
  paths: string[];
  columns: RowColumn[];
}

export type RowPlan =
  | { kind: 'absent' }
  | { kind: 'base'; version: RowVersion }
  | { kind: 'other'; version: RowVersion }
  | { kind: 'convert'; other: RowVersion }
  | ({ kind: 'merge' } & RowFlips);

export type PlannedOutcomeKind = 'absent' | 'base' | 'other' | 'merged';

export function takenFromDraft(
  input: Pick<OutcomeInput, 'operation' | 'applied'>,
  key: string,
): boolean {
  const applied = input.applied.has(key);
  return input.operation === 'commit' ? applied : !applied;
}

export function planTable(
  table: CatalogueTable,
  input: OutcomeInput,
): TablePlan {
  const linkSide = structureSideOf(table, input);
  return {
    linkSide,
    structureDiffers: table.pair.structure?.differs ?? false,
    takesOtherSide: (key) =>
      takenFromDraft(input, key) !== (linkSide === 'draft'),
  };
}

export function structureSideOf(
  table: CatalogueTable,
  input: OutcomeInput,
): RevisionSide {
  if (!table.structureUnit) {
    return input.direction.base;
  }
  return takenFromDraft(input, table.structureUnit) ? 'draft' : 'head';
}

export function planRow(row: CatalogueRow, plan: TablePlan): RowPlan {
  const base = sideOf(row.pair, plan.linkSide);
  const other = sideOf(row.pair, oppositeOf(plan.linkSide));

  if (row.existenceUnit && plan.takesOtherSide(row.existenceUnit)) {
    return bringOther(other, plan);
  }

  if (!base) {
    return { kind: 'absent' };
  }

  if (!other) {
    return { kind: 'base', version: base };
  }

  return flipsOf(row, base, other, plan);
}

export function plannedKind(plan: RowPlan): PlannedOutcomeKind {
  switch (plan.kind) {
    case 'convert':
    case 'merge':
      return 'merged';
    default:
      return plan.kind;
  }
}

export function tableOutcomeOf(
  table: CatalogueTable,
  plan: TablePlan,
  rows: ReadonlyArray<{ row: CatalogueRow; kind: PlannedOutcomeKind }>,
): TableOutcome {
  if (table.kind === 'unchanged') {
    return 'unchanged';
  }

  if (rows.every(({ row, kind }) => keepsLinkedRow(row, kind, plan.linkSide))) {
    return 'base';
  }

  if (
    !table.structureUnit &&
    table.unitKeys.every((key) => plan.takesOtherSide(key)) &&
    rows.every(({ kind }) => kind === 'other' || kind === 'absent')
  ) {
    return 'other';
  }

  return 'mixed';
}

export function settledOutcome(
  table: CatalogueTable,
  outcome: TableOutcome,
  linkSide: RevisionSide,
  input: OutcomeInput,
): { outcome: TableOutcome; draftFollowsHead: boolean } {
  const draftFollowsHead = keepsNoUnits(table, input);
  if (
    !draftFollowsHead ||
    !input.preferOtherForUnitlessTables ||
    table.kind === 'whole'
  ) {
    return { outcome, draftFollowsHead };
  }
  return {
    outcome: outcomeTaking(
      table.pair,
      outcome,
      linkSide,
      input.direction.other,
    ),
    draftFollowsHead,
  };
}

function bringOther(other: RowVersion | undefined, plan: TablePlan): RowPlan {
  if (!other) {
    return { kind: 'absent' };
  }
  return plan.structureDiffers
    ? { kind: 'convert', other }
    : { kind: 'other', version: other };
}

function flipsOf(
  row: CatalogueRow,
  base: RowVersion,
  other: RowVersion,
  plan: TablePlan,
): RowPlan {
  const renameFlips = Boolean(
    row.renameUnit && plan.takesOtherSide(row.renameUnit),
  );
  const paths = [...row.fieldUnits]
    .filter(([, key]) => plan.takesOtherSide(key))
    .map(([path]) => path);
  const columns = [...row.columnOwners]
    .filter(([, key]) => plan.takesOtherSide(key))
    .map(([column]) => column);

  if (!renameFlips && paths.length === 0 && columns.length === 0) {
    return { kind: 'base', version: base };
  }

  const wholeRowFlips =
    (!row.renameUnit || renameFlips) &&
    paths.length === row.fieldUnits.size &&
    columns.length === row.columnOwners.size;
  if (!plan.structureDiffers && wholeRowFlips) {
    return { kind: 'other', version: other };
  }

  return { kind: 'merge', base, other, renameFlips, paths, columns };
}

function keepsLinkedRow(
  row: CatalogueRow,
  kind: PlannedOutcomeKind,
  linkSide: RevisionSide,
): boolean {
  return kind === 'base' || (kind === 'absent' && !sideOf(row.pair, linkSide));
}

function outcomeTaking(
  pair: TablePair,
  outcome: TableOutcome,
  linkSide: RevisionSide,
  side: RevisionSide,
): TableOutcome {
  const wanted = sideOf(pair, side);
  if (!wanted) {
    return outcome;
  }
  if (sideOf(pair, oppositeOf(side))?.versionId === wanted.versionId) {
    return outcome;
  }
  return linkSide === side ? 'base' : 'other';
}
