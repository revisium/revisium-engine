import { Injectable } from '@nestjs/common';
import {
  type AppliedUnits,
  type ChangeOperation,
  OutcomeRules,
  type RevisionSide,
  type RowOutcome,
  type TableOutcome,
  type TableOutcomeRules,
  type TableUnits,
} from 'src/features/partial-changes/assembly/outcome-rules';
import {
  type DraftStructureMigration,
  type MergedRow,
  type MergeTarget,
  type RowMerge,
  RowMerger,
} from 'src/features/partial-changes/assembly/row-merger';
import type { CatalogueRow } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import { differInContent } from 'src/features/partial-changes/catalogue/row-differences';
import { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import type { PlanBlocker } from 'src/features/partial-changes/selection/selection-resolution';
import type {
  ChangesSnapshot,
  ComparedTable,
  RowPair,
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { SchemaLeaves } from 'src/features/partial-changes/structure/schema-leaves';
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
  readonly versionId?: string;
  readonly relinkCandidate: boolean;
  readonly rows: readonly TargetRow[];
}

export interface DeferredValues {
  readonly unitKey: string;
  readonly paths: readonly string[];
  readonly structureKey: string;
}

export interface AssembledTarget {
  readonly tables: readonly TablePlan[];
  readonly blockers: readonly PlanBlocker[];
  readonly deferred: readonly DeferredValues[];
}

interface AssembledTable {
  readonly plan: TablePlan;
  readonly blockers: readonly PlanBlocker[];
  readonly deferred: readonly DeferredValues[];
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
  readonly units: TableUnits;
  readonly rows: readonly CatalogueRow[];
}

interface ReadTableContext {
  readonly operation: ChangeOperation;
  readonly target: MergeTarget;
  readonly rowMerger: RowMerger;
}

interface DecidedRow {
  readonly row: CatalogueRow;
  readonly outcome: RowOutcome;
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
  ): Promise<AssembledTarget> {
    const tables = await new TargetAssembly(
      source,
      new OutcomeRules(choice),
      this.rowMerger,
    ).assembleUserTables();

    return {
      tables: tables.map(({ plan }) => plan),
      blockers: tables.flatMap(({ blockers }) => blockers),
      deferred: tables.flatMap(({ deferred }) => deferred),
    };
  }
}

class TargetAssembly {
  private readonly lookup: CatalogueLookup;

  constructor(
    private readonly source: AssemblySource,
    private readonly rules: OutcomeRules,
    private readonly rowMerger: RowMerger,
  ) {
    this.lookup = new CatalogueLookup(source.catalogue);
  }

  public async assembleUserTables(): Promise<AssembledTable[]> {
    const assembled: AssembledTable[] = [];

    for (const table of this.readTables()) {
      assembled.push(await this.assembleReadTable(table));
    }

    return [...assembled, ...this.assembleOneSidedTables()];
  }

  private assembleReadTable(table: ReadTable): Promise<AssembledTable> {
    const rules = this.rules.forTable({
      units: table.units,
      structureDiffers: table.structure.differs,
    });

    return new ReadTableAssembly(table, rules, {
      operation: this.rules.operation,
      target: this.mergeTargetOf(table.pair, rules.structureSide),
      rowMerger: this.rowMerger,
    }).assemble();
  }

  private assembleOneSidedTables(): AssembledTable[] {
    return this.source.snapshot.tables.flatMap((pair) => {
      const structure = this.lookup.tableUnitOf('structure', pair);

      if (!structure || isOnBothSides(pair)) {
        return [];
      }

      return [
        {
          plan: this.oneSidedTablePlan(pair, structure.key),
          blockers: [],
          deferred: [],
        },
      ];
    });
  }

  private oneSidedTablePlan(pair: TablePair, structure: string): TablePlan {
    const rules = this.rules.forTable({
      units: { structure, rows: [] },
      structureDiffers: true,
    });

    return {
      identity: pair.identity,
      outcome: rules.outcomeOfOneSidedTable(pair),
      structureSide: rules.structureSide,
      versionId: pair[rules.structureSide]?.versionId,
      ...NO_LINK_CHANGES,
      relinkCandidate: false,
      rows: [],
    };
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

    return [...catalogue.rows].map(([identity, rows]) => {
      const pair = requiredOf(snapshot.tables, identity);

      return {
        pair,
        structure: requiredOf(tables, identity).structure,
        units: this.unitsOf(pair),
        rows,
      };
    });
  }
}

class ReadTableAssembly {
  private readonly decided: readonly DecidedRow[];
  private readonly draftStructure?: DraftStructureMigration;

  constructor(
    private readonly table: ReadTable,
    private readonly rules: TableOutcomeRules,
    private readonly context: ReadTableContext,
  ) {
    this.decided = table.rows.map((row) => ({
      row,
      outcome: rules.rowOutcomeOf(row),
    }));
    this.draftStructure = recordedDraftStructureOf(table);
  }

  public async assemble(): Promise<AssembledTable> {
    const { pair } = this.table;
    const rows = await this.targetRows();
    const outcome = this.rules.tableOutcomeOf(rows);

    return {
      plan: {
        identity: pair.identity,
        outcome,
        structureSide: this.rules.structureSide,
        versionId: linkedVersionOf(pair, outcome, this.rules).versionId,
        ...linkChangesOf(outcome, rows, this.rules),
        relinkCandidate: this.rules.isRelinkCandidate(),
        rows,
      },
      blockers: this.unrecordedStructureBlockers(),
      deferred: this.deferredValues(),
    };
  }

  private async targetRows(): Promise<TargetRow[]> {
    const newVersions = await this.newVersions();

    return this.decided.map(({ row: { pair }, outcome }) =>
      targetRowOf(pair, outcome, newVersions.get(pair.identity), this.rules),
    );
  }

  private async newVersions(): Promise<ReadonlyMap<string, MergedRow>> {
    const versions = [
      ...(await this.mergedRows()),
      ...(await this.movedRows()),
    ];

    return new Map(versions.map((row) => [row.createdId, row]));
  }

  private mergedRows(): Promise<MergedRow[]> {
    const merges = this.decided.flatMap((row) => rowMergesOf(row, this.rules));

    return this.context.rowMerger.merge(merges, this.context.target);
  }

  private async movedRows(): Promise<MergedRow[]> {
    const { rowMerger, target } = this.context;
    const rows = this.rowsMoving().map(({ row }) =>
      versionOn(row.pair, this.rules.otherSide),
    );

    if (this.rules.structureSide === 'head') {
      return rowMerger.mapIntoHeadStructure(
        rows,
        this.table.structure.unchangedLeaves,
        target,
      );
    }

    if (!this.draftStructure) {
      return [];
    }

    return rowMerger.migrateIntoDraftStructure(
      rows,
      this.draftStructure,
      target,
    );
  }

  private rowsMoving(): DecidedRow[] {
    return this.decided.filter(({ outcome }) => outcome.kind === 'move');
  }

  private unrecordedStructureBlockers(): PlanBlocker[] {
    if (!this.takesUnrecordedDraftStructure()) {
      return [];
    }

    return [unrecordedStructureChangeOf(this.table.pair)];
  }

  private takesUnrecordedDraftStructure(): boolean {
    return (
      this.rules.structureSide === 'draft' &&
      !this.draftStructure &&
      (this.context.operation === 'commit' || this.rowsMoving().length > 0)
    );
  }

  private deferredValues(): DeferredValues[] {
    const structureKey = this.table.units.structure;

    if (!this.commitsWithoutStructure() || structureKey === undefined) {
      return [];
    }

    const paths = changedDraftFieldsOf(this.table);

    return this.rowsMoving().flatMap(({ row }) =>
      deferredValuesOf(row, paths, structureKey),
    );
  }

  private commitsWithoutStructure(): boolean {
    return (
      this.context.operation === 'commit' && this.rules.structureSide === 'head'
    );
  }
}

function recordedDraftStructureOf({
  pair,
  structure,
}: ReadTable): DraftStructureMigration | undefined {
  const { recorded, pendingHistory } = structure;

  if (!recorded || !pendingHistory.extendsHead) {
    return undefined;
  }

  return {
    headSchema: versionOn(pair, 'head').schema,
    pendingHistory: pendingHistory.entries,
  };
}

function rowMergesOf(
  { row: { pair }, outcome }: DecidedRow,
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
  pair: RowPair,
  outcome: RowOutcome,
  newVersion: MergedRow | undefined,
  rules: TableOutcomeRules,
): TargetRow {
  if (outcome.kind !== 'merge' && outcome.kind !== 'move') {
    return { pair, kind: outcome.kind };
  }

  if (newVersion) {
    return collapsedRowOf(pair, newVersion, rules);
  }

  if (outcome.kind === 'move') {
    return { pair, kind: 'absent' };
  }

  throw new Error(`Row ${publicIdOf(pair)} was not merged`);
}

function collapsedRowOf(
  pair: RowPair,
  newVersion: MergedRow,
  rules: TableOutcomeRules,
): TargetRow {
  if (equalsVersionOn(pair, rules.structureSide, newVersion)) {
    return { pair, kind: 'structureSide' };
  }

  if (equalsVersionOn(pair, rules.otherSide, newVersion)) {
    return { pair, kind: 'otherSide' };
  }

  return { pair, kind: 'merge', merged: newVersion };
}

function equalsVersionOn(
  pair: RowPair,
  side: RevisionSide,
  newVersion: MergedRow,
): boolean {
  const version = pair[side];

  return version !== undefined && !differInContent(newVersion, version);
}

function changedDraftFieldsOf({ pair, structure }: ReadTable): string[] {
  const unchanged = new Set(
    structure.unchangedLeaves.map(({ pointer }) => pointer.toString()),
  );

  return SchemaLeaves.of(versionOn(pair, 'draft').schema)
    .all.filter(
      ({ pointer, kind }) =>
        kind !== 'computed' && !unchanged.has(pointer.toString()),
    )
    .map(({ pointer }) => pointer.toString());
}

function deferredValuesOf(
  { existence }: CatalogueRow,
  paths: readonly string[],
  structureKey: string,
): DeferredValues[] {
  if (existence === undefined || paths.length === 0) {
    return [];
  }

  return [{ unitKey: existence, paths, structureKey }];
}

function unrecordedStructureChangeOf(pair: TablePair): PlanBlocker {
  const tableId = publicIdOf(pair);

  return {
    code: 'unrecordedStructureChange',
    tableId,
    message: `The Draft structure of ${tableId} is not reproduced by its schema history and migrations: its commit is refused, and Head rows cannot be migrated into it`,
  };
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

function isOnBothSides({ head, draft }: TablePair): boolean {
  return head !== undefined && draft !== undefined;
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
