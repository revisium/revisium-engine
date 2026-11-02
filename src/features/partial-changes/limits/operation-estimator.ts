import { Injectable } from '@nestjs/common';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import {
  OutcomeRules,
  type RowOutcomeKind,
  type RowWithOutcome,
  type TableOutcome,
} from 'src/features/partial-changes/assembly/outcome-rules';
import {
  type ReadTable,
  readTablesOf,
  tableRulesOf,
} from 'src/features/partial-changes/assembly/read-tables';
import {
  type SystemTableTarget,
  systemTableOutcomeOf,
  systemTableTargetsOf,
} from 'src/features/partial-changes/assembly/system-table-targets';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import { PartialChangesLimits } from 'src/features/partial-changes/limits/partial-changes-limits';
import { estimateTooLarge } from 'src/features/partial-changes/limits/too-large-blockers';
import type { AppliedUnits } from 'src/features/partial-changes/plan/change-operation';
import type { PlanBlocker } from 'src/features/partial-changes/plan/plan-blocker';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import {
  type TableVersion,
  versionOn,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { hasFormulaOrFileFields } from 'src/features/partial-changes/structure/schema-fields';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

export interface MixedTableEstimate {
  readonly tableId: string;
  readonly linksCopied: number;
  readonly linksAdded: number;
}

export interface Estimate {
  readonly changedRows: number;
  readonly mergedRows: number;
  readonly perRowWorkRows: number;
  readonly mixedTables: readonly MixedTableEstimate[];
}

export interface EstimationSource extends AssemblySource {
  readonly changedRowCount: number;
}

export type GuardedEstimate =
  | { readonly kind: 'withinLimits'; readonly estimate: Estimate }
  | {
      readonly kind: 'tooLarge';
      readonly estimate: Estimate;
      readonly blockers: readonly PlanBlocker[];
    };

interface PlannedTable {
  readonly version: TableVersion;
  readonly structureSide: RevisionSide;
  readonly editInPlace: boolean;
  readonly rows: readonly RowWithOutcome[];
  readonly outcome: TableOutcome;
}

const CONVERTED_ROWS: ReadonlySet<RowOutcomeKind> = new Set(['merge', 'move']);
const ROWS_LEAVING_STRUCTURE_SIDE: ReadonlySet<RowOutcomeKind> = new Set([
  'absent',
  'otherSide',
]);
const ROWS_LINKED_FROM_OTHER_SIDE: ReadonlySet<RowOutcomeKind> = new Set([
  'otherSide',
  'merge',
  'move',
]);

@Injectable()
export class OperationEstimator {
  constructor(
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly limits: PartialChangesLimits,
  ) {}

  public estimationOf(source: EstimationSource): OperationEstimation {
    return new OperationEstimation(source, this.snapshotReader, this.limits);
  }
}

export class OperationEstimation {
  private readonly tables: readonly ReadTable[];
  private readonly rowLinks = new Map<string, number>();

  constructor(
    private readonly source: EstimationSource,
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly limits: PartialChangesLimits,
  ) {
    this.tables = readTablesOf(source);
  }

  public async estimateAndGuard(
    choice: AppliedUnits,
  ): Promise<GuardedEstimate> {
    const estimate = await this.estimate(choice);
    const blockers = estimateTooLarge(estimate, this.limits);

    if (blockers.length === 0) {
      return { kind: 'withinLimits', estimate };
    }

    return { kind: 'tooLarge', estimate, blockers };
  }

  private async estimate(choice: AppliedUnits): Promise<Estimate> {
    const rules = new OutcomeRules(choice);
    const mixed = this.tables
      .map((table) => plannedTableOf(table, rules))
      .filter(({ outcome }) => outcome === 'mixed');
    const mixedTables: MixedTableEstimate[] = [];

    for (const table of mixed) {
      mixedTables.push(await this.mixedTableEstimate(table));
    }

    return {
      changedRows: this.source.changedRowCount,
      mergedRows: convertedRowsIn(mixed),
      perRowWorkRows: convertedRowsIn(mixed.filter(needsPerRowWork)),
      mixedTables: inTableIdOrder([
        ...mixedTables,
        ...this.mixedSystemTables(rules),
      ]),
    };
  }

  private async mixedTableEstimate(
    table: PlannedTable,
  ): Promise<MixedTableEstimate> {
    return {
      tableId: table.version.id,
      linksCopied: await this.linksCopiedInto(table),
      linksAdded: table.rows.filter(({ kind }) =>
        ROWS_LINKED_FROM_OTHER_SIDE.has(kind),
      ).length,
    };
  }

  private async linksCopiedInto({
    version,
    structureSide,
    editInPlace,
    rows,
  }: PlannedTable): Promise<number> {
    if (editInPlace) {
      return 0;
    }

    const leaving = rows.filter(
      ({ pair, kind }) =>
        ROWS_LEAVING_STRUCTURE_SIDE.has(kind) &&
        pair[structureSide] !== undefined,
    );

    return (await this.rowLinksOf(version.versionId)) - leaving.length;
  }

  private mixedSystemTables(rules: OutcomeRules): MixedTableEstimate[] {
    return systemTableTargetsOf(this.source, rules)
      .filter(mayBeMixed)
      .map(systemTableEstimateOf);
  }

  private async rowLinksOf(tableVersionId: string): Promise<number> {
    const counted = this.rowLinks.get(tableVersionId);

    if (counted !== undefined) {
      return counted;
    }

    const count = await this.snapshotReader.countRowLinks(tableVersionId);
    this.rowLinks.set(tableVersionId, count);

    return count;
  }
}

function plannedTableOf(table: ReadTable, rules: OutcomeRules): PlannedTable {
  const tableRules = tableRulesOf(rules, table);
  const rows = table.rows.map((row) => ({
    pair: row.pair,
    kind: tableRules.rowOutcomeOf(row).kind,
  }));

  return {
    version: versionOn(table.pair, tableRules.structureSide),
    structureSide: tableRules.structureSide,
    editInPlace: tableRules.editsDraftInPlace(table.pair),
    rows,
    outcome: tableRules.tableOutcomeOf(rows),
  };
}

function inTableIdOrder(
  tables: readonly MixedTableEstimate[],
): MixedTableEstimate[] {
  return [...tables].sort((left, right) =>
    compareCodePoints(left.tableId, right.tableId),
  );
}

function convertedRowsIn(tables: readonly PlannedTable[]): number {
  return tables.reduce(
    (count, { rows }) =>
      count + rows.filter(({ kind }) => CONVERTED_ROWS.has(kind)).length,
    0,
  );
}

function mayBeMixed(target: SystemTableTarget): boolean {
  const outcome = systemTableOutcomeOf(
    target,
    target.versions,
    target.rewrites.length > 0,
  );

  return outcome === 'mixed';
}

function systemTableEstimateOf(target: SystemTableTarget): MixedTableEstimate {
  const { tableId, rows, linkSide, versions, rewrites } = target;
  const linkedIds = new Set(rows[linkSide].map(({ versionId }) => versionId));

  return {
    tableId,
    linksCopied: systemLinksCopied(target),
    linksAdded:
      versions.filter(({ versionId }) => !linkedIds.has(versionId)).length +
      rewrites.length,
  };
}

function systemLinksCopied({
  rows,
  linkSide,
  editInPlace,
  versions,
  rewrites,
}: SystemTableTarget): number {
  if (editInPlace) {
    return 0;
  }

  const possiblyKept = new Set(
    [...versions, ...rewrites.map(({ source }) => source)].map(
      ({ versionId }) => versionId,
    ),
  );

  return rows[linkSide].filter(({ versionId }) => possiblyKept.has(versionId))
    .length;
}

function needsPerRowWork({ version }: PlannedTable): boolean {
  return hasFormulaOrFileFields(version.schema);
}
