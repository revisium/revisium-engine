import { Injectable } from '@nestjs/common';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type {
  RevisionSide,
  RowLinkChanges,
} from 'src/features/draft-revision/commands/impl/target-write-plan';
import { NO_LINK_CHANGES } from 'src/features/partial-changes/assembly/link-changes';
import {
  type LedgerPlan,
  planLedger,
} from 'src/features/partial-changes/assembly/ledger-plan';
import {
  OutcomeRules,
  type RowOutcome,
  type TableOutcome,
  type TableOutcomeRules,
} from 'src/features/partial-changes/assembly/outcome-rules';
import {
  type ReadTable,
  readTablesOf,
  tableRulesOf,
} from 'src/features/partial-changes/assembly/read-tables';
import {
  type DraftStructureMigration,
  type MergedRow,
  type MergeTarget,
  type RowMerge,
  RowMerger,
} from 'src/features/partial-changes/assembly/row-merger';
import {
  type TableViews,
  tableViewsOf,
} from 'src/features/partial-changes/assembly/system-table-targets';
import {
  type SystemTablePlan,
  systemTablePlansOf,
} from 'src/features/partial-changes/assembly/system-table-plans';
import type { CatalogueRow } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import { differInContent } from 'src/features/partial-changes/catalogue/row-differences';
import type {
  AppliedUnits,
  ChangeOperation,
} from 'src/features/partial-changes/plan/change-operation';
import {
  type CatalogueBlocker,
  unrecordedStructureChangeOf,
} from 'src/features/partial-changes/plan/plan-blocker';
import {
  type ChangesSnapshot,
  type ComparedTable,
  publicIdOrIdentityOf,
  type RowPair,
  type TablePair,
  type TableVersion,
  versionOn,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import {
  type SchemaLeaf,
  SchemaLeaves,
} from 'src/features/partial-changes/structure/schema-leaves';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

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

export interface TablePlan extends RowLinkChanges {
  readonly identity: string;
  readonly outcome: TableOutcome;
  readonly structureSide: RevisionSide;
  readonly versionId?: string;
  readonly editInPlace: boolean;
  readonly relinkCandidate: boolean;
  readonly rows: readonly TargetRow[];
}

export interface DeferredValue {
  readonly path: string;
  readonly value: unknown;
}

export interface DeferredPath {
  readonly path: string;
}

export interface DeferredValues {
  readonly unitKey: string;
  readonly defaulted: readonly DeferredValue[];
  readonly omitted: readonly DeferredPath[];
  readonly structureKey: string;
}

export interface AssembledTarget {
  readonly tables: readonly TablePlan[];
  readonly systemTables: readonly SystemTablePlan[];
  readonly views: readonly TableViews[];
  readonly ledger: LedgerPlan;
  readonly blockers: readonly CatalogueBlocker[];
  readonly deferred: readonly DeferredValues[];
}

interface AssembledTable {
  readonly plan: TablePlan;
  readonly blockers: readonly CatalogueBlocker[];
  readonly deferred: readonly DeferredValues[];
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

@Injectable()
export class TargetAssembler {
  constructor(private readonly rowMerger: RowMerger) {}

  public async assemble(
    source: AssemblySource,
    choice: AppliedUnits,
  ): Promise<AssembledTarget> {
    const rules = new OutcomeRules(choice);
    const tables = await new TargetAssembly(
      source,
      rules,
      this.rowMerger,
    ).assembleUserTables();

    return {
      tables: tables.map(({ plan }) => plan),
      systemTables: systemTablePlansOf(source, rules),
      views: tableViewsOf(source, rules),
      ledger: planLedger(source, rules),
      blockers: tables.flatMap(({ blockers }) => blockers),
      deferred: tables.flatMap(({ deferred }) => deferred),
    };
  }
}

class TargetAssembly {
  constructor(
    private readonly source: AssemblySource,
    private readonly rules: OutcomeRules,
    private readonly rowMerger: RowMerger,
  ) {}

  public async assembleUserTables(): Promise<AssembledTable[]> {
    const assembled: AssembledTable[] = [];

    for (const table of readTablesOf(this.source)) {
      assembled.push(await this.assembleReadTable(table));
    }

    return [...assembled, ...this.assembleOneSidedTables()];
  }

  private assembleReadTable(table: ReadTable): Promise<AssembledTable> {
    const rules = tableRulesOf(this.rules, table);

    return new ReadTableAssembly(table, rules, {
      operation: this.rules.operation,
      target: this.mergeTargetOf(table.pair, rules.structureSide),
      rowMerger: this.rowMerger,
    }).assemble();
  }

  private assembleOneSidedTables(): AssembledTable[] {
    return this.source.snapshot.tables.flatMap((pair) => {
      const structure = this.source.catalogue.lookup.tableUnitOf(
        'structure',
        pair,
      );

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
      editInPlace: false,
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
    const newVersions = await this.newVersions();
    const rows = this.targetRowsOf(newVersions);
    const outcome = this.rules.tableOutcomeOf(rows);

    return {
      plan: {
        identity: pair.identity,
        outcome,
        structureSide: this.rules.structureSide,
        versionId: linkedVersionOf(pair, outcome, this.rules).versionId,
        editInPlace: this.rules.editsDraftInPlace(pair),
        ...linkChangesOf(outcome, rows, this.rules),
        relinkCandidate: this.rules.isRelinkCandidate(),
        rows,
      },
      blockers: this.unrecordedStructureBlockers(),
      deferred: this.deferredValues(newVersions),
    };
  }

  private targetRowsOf(
    newVersions: ReadonlyMap<string, MergedRow>,
  ): TargetRow[] {
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

    if (rows.length === 0) {
      return [];
    }

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

  private unrecordedStructureBlockers(): CatalogueBlocker[] {
    if (!this.takesUnrecordedDraftStructure()) {
      return [];
    }

    return [unrecordedStructureChangeOf(this.table.pair)];
  }

  private takesUnrecordedDraftStructure(): boolean {
    return (
      this.rules.structureSide === 'draft' &&
      !this.draftStructure &&
      this.rowsMoving().length > 0
    );
  }

  // A row moved into the Head structure has the value the commit writes at each deferred pointer the Head schema
  // keeps as an input field; its version is the row assembled by mapIntoHeadStructure.
  private deferredValues(
    newVersions: ReadonlyMap<string, MergedRow>,
  ): DeferredValues[] {
    const structureKey = this.table.units.structure;

    if (!this.commitsWithoutStructure() || structureKey === undefined) {
      return [];
    }

    const pointers = deferredPointersOf(this.table);

    return this.rowsMoving().flatMap(({ row }) =>
      deferredValuesOf(
        row,
        newVersions.get(row.pair.identity),
        pointers,
        structureKey,
      ),
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

  throw new Error(`Row ${publicIdOrIdentityOf(pair)} was not merged`);
}

function collapsedRowOf(
  pair: RowPair,
  newVersion: MergedRow,
  rules: TableOutcomeRules,
): TargetRow {
  const otherSide = pair[rules.otherSide];

  if (otherSide !== undefined && !differInContent(newVersion, otherSide)) {
    return { pair, kind: 'otherSide' };
  }

  return { pair, kind: 'merge', merged: newVersion };
}

interface DeferredPointers {
  readonly defaulted: readonly SchemaLeaf[];
  readonly omitted: readonly JsonPointer[];
}

// The changed input fields of either side, in code-point order as the structure description lists them: the Head
// schema keeps an input leaf at a defaulted pointer, and has none or computes the value at an omitted one.
function deferredPointersOf({ pair, structure }: ReadTable): DeferredPointers {
  const head = SchemaLeaves.of(versionOn(pair, 'head').schema);
  const draft = SchemaLeaves.of(versionOn(pair, 'draft').schema);
  const changed = structure.changedPointers
    .filter(
      (pointer) =>
        inputLeafAt(head, pointer) !== undefined ||
        inputLeafAt(draft, pointer) !== undefined,
    )
    .sort((left, right) =>
      compareCodePoints(left.toString(), right.toString()),
    );

  return {
    defaulted: changed.flatMap((pointer) => inputLeafAt(head, pointer) ?? []),
    omitted: changed.filter(
      (pointer) => inputLeafAt(head, pointer) === undefined,
    ),
  };
}

function inputLeafAt(
  leaves: SchemaLeaves,
  pointer: JsonPointer,
): SchemaLeaf | undefined {
  const leaf = leaves.at(pointer);

  return leaf?.kind === 'computed' ? undefined : leaf;
}

function deferredValuesOf(
  { existence, pair }: CatalogueRow,
  written: MergedRow | undefined,
  { defaulted, omitted }: DeferredPointers,
  structureKey: string,
): DeferredValues[] {
  if (existence === undefined || defaulted.length + omitted.length === 0) {
    return [];
  }

  if (written === undefined) {
    throw new Error(
      `Row ${publicIdOrIdentityOf(pair)} was not assembled into the Head structure`,
    );
  }

  return [
    {
      unitKey: existence,
      defaulted: defaulted.map((leaf) => ({
        path: leaf.pointer.toString(),
        value: writtenValueAt(written, leaf),
      })),
      omitted: omitted.map((pointer) => ({ path: pointer.toString() })),
      structureKey,
    },
  ];
}

// The published-at field reads the row's publishedAt column (§3.1); its data leaf keeps ''. A defaulted File is a new
// one, whose id every planning mints anew: it is shown without it, so that two plans of one Draft agree.
function writtenValueAt(
  written: MergedRow,
  { pointer, kind, schema }: SchemaLeaf,
): unknown {
  if (kind === 'publishedAt') {
    return written.publishedAt.toISOString();
  }

  const value = structuredClone(pointer.valueIn(written.data));

  if (isFileSchema(schema)) {
    return { ...(value as object), fileId: '' };
  }

  return value;
}

function isFileSchema(schema: JsonSchema): boolean {
  return '$ref' in schema && schema.$ref === SystemSchemaIds.File;
}

function linkChangesOf(
  outcome: TableOutcome,
  rows: readonly TargetRow[],
  rules: TableOutcomeRules,
): RowLinkChanges {
  if (outcome !== 'mixed') {
    return NO_LINK_CHANGES;
  }

  return {
    removedRowVersionIds: rows
      .filter(({ kind }) => kind !== 'structureSide')
      .flatMap(({ pair }) => versionIdsOn(pair, rules.structureSide)),
    addedRowVersionIds: rows
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

function isOnBothSides({ head, draft }: TablePair): boolean {
  return head !== undefined && draft !== undefined;
}
