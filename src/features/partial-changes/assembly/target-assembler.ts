import { Injectable } from '@nestjs/common';
import {
  type AppliedUnits,
  OutcomeRules,
  type RevisionSide,
  type RowOutcome,
  type TableOutcome,
  type TableOutcomeRules,
  type TableUnits,
} from 'src/features/partial-changes/assembly/outcome-rules';
import {
  type MergedRow,
  type MergeTarget,
  type RowMerge,
  RowMerger,
} from 'src/features/partial-changes/assembly/row-merger';
import type { CatalogueRow } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import { differInContent } from 'src/features/partial-changes/catalogue/row-differences';
import { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import type {
  ChangesSnapshot,
  ComparedTable,
  RowPair,
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';

export interface AssemblySource {
  readonly snapshot: ChangesSnapshot;
  readonly tables: readonly ComparedTable[];
  readonly catalogue: ChangeCatalogue;
}

export type TargetRow =
  | {
      readonly pair: RowPair;
      readonly kind: 'absent' | 'structureSide' | 'otherSide';
    }
  | {
      readonly pair: RowPair;
      readonly kind: 'merge';
      readonly merged: MergedRow;
    };

export interface LinkChanges {
  readonly removedLinks: readonly string[];
  readonly addedLinks: readonly string[];
  readonly newRows: readonly MergedRow[];
}

export interface TablePlan extends LinkChanges {
  readonly identity: string;
  readonly outcome: TableOutcome;
  readonly structureSide: RevisionSide;
  readonly versionId: string;
  readonly relinkCandidate: boolean;
  readonly rows: readonly TargetRow[];
}

interface Version {
  readonly id: string;
}

interface VersionPair<T extends Version> {
  readonly identity: string;
  readonly head?: T;
  readonly draft?: T;
}

interface ReadTable {
  readonly pair: TablePair;
  readonly structure: TableStructure;
  readonly rows: readonly CatalogueRow[];
}

interface DecidedRow {
  readonly pair: RowPair;
  readonly outcome: Exclude<RowOutcome, { readonly kind: 'move' }>;
}

const NO_LINK_CHANGES: LinkChanges = {
  removedLinks: [],
  addedLinks: [],
  newRows: [],
};

@Injectable()
export class TargetAssembler {
  constructor(private readonly rowMerger: RowMerger) {}

  public async assemble(
    source: AssemblySource,
    choice: AppliedUnits,
  ): Promise<TablePlan[]> {
    refuseAppliedStructureUnits(source.catalogue, choice);

    return new TargetAssembly(source, choice, this.rowMerger).planReadTables();
  }
}

class TargetAssembly {
  private readonly rules: OutcomeRules;
  private readonly lookup: CatalogueLookup;

  constructor(
    private readonly source: AssemblySource,
    choice: AppliedUnits,
    private readonly rowMerger: RowMerger,
  ) {
    this.rules = new OutcomeRules(choice);
    this.lookup = new CatalogueLookup(source.catalogue);
  }

  public async planReadTables(): Promise<TablePlan[]> {
    const plans: TablePlan[] = [];

    for (const table of this.readTables()) {
      plans.push(await this.planTable(table));
    }

    return plans;
  }

  private async planTable(table: ReadTable): Promise<TablePlan> {
    const rules = this.rules.forTable({
      units: this.unitsOf(table.pair),
      structureDiffers: table.structure.differs,
    });
    const rows = await this.targetRowsOf(table, rules);
    const outcome = rules.tableOutcomeOf(rows);

    return {
      identity: table.pair.identity,
      outcome,
      structureSide: rules.structureSide,
      versionId: linkedVersionOf(table.pair, outcome, rules).versionId,
      ...linkChangesOf(outcome, rows, rules),
      relinkCandidate: rules.isRelinkCandidate(),
      rows,
    };
  }

  private async targetRowsOf(
    table: ReadTable,
    rules: TableOutcomeRules,
  ): Promise<TargetRow[]> {
    const decided = table.rows.map((row) => decidedRowOf(table, row, rules));
    const merged = await this.mergedRowsOf(table, decided, rules);

    return decided.map((row) =>
      targetRowOf(row, merged.get(row.pair.identity), rules),
    );
  }

  private async mergedRowsOf(
    table: ReadTable,
    decided: readonly DecidedRow[],
    rules: TableOutcomeRules,
  ): Promise<ReadonlyMap<string, MergedRow>> {
    const merges = decided.flatMap((row) => rowMergesOf(row, rules));
    const merged = await this.rowMerger.merge(
      merges,
      this.mergeTargetOf(table.pair, rules.structureSide),
    );

    return new Map(merged.map((row) => [row.createdId, row]));
  }

  private mergeTargetOf(pair: TablePair, side: RevisionSide): MergeTarget {
    const { id, schema } = versionOn(pair, side);

    return { revisionId: this.revisionIdOf(side), tableId: id, schema };
  }

  private revisionIdOf(side: RevisionSide): string {
    const { headRevisionId, draftRevisionId } = this.source.snapshot;

    if (side === 'head') {
      return headRevisionId;
    }

    return draftRevisionId;
  }

  private unitsOf(pair: TablePair): TableUnits {
    return {
      structure: this.lookup.tableUnitOf('structure', pair)?.key,
      rows: this.lookup.rowLevelUnitsOf(pair).map(({ key }) => key),
    };
  }

  private readTables(): ReadTable[] {
    const { snapshot, tables, catalogue } = this.source;

    return [...catalogue.rows].map(([identity, rows]) => ({
      pair: requiredOf(snapshot.tables, identity),
      structure: requiredOf(tables, identity).structure,
      rows,
    }));
  }
}

function refuseAppliedStructureUnits(
  catalogue: ChangeCatalogue,
  { applied }: AppliedUnits,
): void {
  const structure = catalogue.units.find(
    ({ key, unit }) => unit.kind === 'structure' && applied.has(key),
  );

  if (structure) {
    throw new Error(
      `The structure unit of ${structure.unit.tableId} is applied, and assembly across structures is not available yet`,
    );
  }
}

function decidedRowOf(
  table: ReadTable,
  row: CatalogueRow,
  rules: TableOutcomeRules,
): DecidedRow {
  const outcome = rules.rowOutcomeOf(row);

  if (outcome.kind === 'move') {
    throw new Error(
      `Row ${publicIdOf(row.pair)} of ${publicIdOf(table.pair)} would move between structures, and assembly across structures is not available yet`,
    );
  }

  return { pair: row.pair, outcome };
}

function rowMergesOf(
  { pair, outcome }: DecidedRow,
  rules: TableOutcomeRules,
): RowMerge[] {
  if (outcome.kind !== 'merge') {
    return [];
  }

  return [
    {
      structureSide: versionOn(pair, rules.structureSide),
      otherSide: versionOn(pair, rules.otherSide),
      fromOtherSide: outcome.fromOtherSide,
    },
  ];
}

function targetRowOf(
  { pair, outcome }: DecidedRow,
  merged: MergedRow | undefined,
  rules: TableOutcomeRules,
): TargetRow {
  if (outcome.kind !== 'merge') {
    return { pair, kind: outcome.kind };
  }

  if (!merged) {
    throw new Error(`Row ${publicIdOf(pair)} was not merged`);
  }

  return collapsedRowOf(pair, merged, rules);
}

function collapsedRowOf(
  pair: RowPair,
  merged: MergedRow,
  rules: TableOutcomeRules,
): TargetRow {
  if (!differInContent(merged, versionOn(pair, rules.structureSide))) {
    return { pair, kind: 'structureSide' };
  }

  if (!differInContent(merged, versionOn(pair, rules.otherSide))) {
    return { pair, kind: 'otherSide' };
  }

  return { pair, kind: 'merge', merged };
}

function linkChangesOf(
  outcome: TableOutcome,
  rows: readonly TargetRow[],
  rules: TableOutcomeRules,
): LinkChanges {
  if (outcome !== 'mixed') {
    return NO_LINK_CHANGES;
  }

  return {
    removedLinks: rows
      .filter(({ kind }) => kind !== 'structureSide')
      .flatMap(({ pair }) => versionIdsOn(pair, rules.structureSide)),
    addedLinks: rows
      .filter(({ kind }) => kind === 'otherSide')
      .flatMap(({ pair }) => versionIdsOn(pair, rules.otherSide)),
    newRows: rows.flatMap(newRowsOf),
  };
}

function newRowsOf(row: TargetRow): MergedRow[] {
  if (row.kind !== 'merge') {
    return [];
  }

  return [row.merged];
}

function linkedVersionOf(
  pair: TablePair,
  outcome: TableOutcome,
  rules: TableOutcomeRules,
): TableVersion {
  if (outcome === 'other') {
    return versionOn(pair, rules.otherSide);
  }

  return versionOn(pair, rules.structureSide);
}

function versionIdsOn(pair: RowPair, side: RevisionSide): string[] {
  const version = pair[side];

  if (!version) {
    return [];
  }

  return [version.versionId];
}

function versionOn<T extends Version>(
  pair: VersionPair<T>,
  side: RevisionSide,
): T {
  const version = pair[side];

  if (!version) {
    throw new Error(`${publicIdOf(pair)} has no ${side} version`);
  }

  return version;
}

function publicIdOf({ identity, head, draft }: VersionPair<Version>): string {
  return draft?.id ?? head?.id ?? identity;
}

function requiredOf<T extends { readonly identity: string }>(
  items: readonly T[],
  identity: string,
): T {
  const item = items.find((candidate) => candidate.identity === identity);

  if (!item) {
    throw new Error(`Table ${identity} is not in the compared snapshot`);
  }

  return item;
}
