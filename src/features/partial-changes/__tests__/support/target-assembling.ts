import type { Migration } from '@revisium/schema-toolkit/types';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  type ChangeOperation,
  oppositeOf,
  type RevisionSide,
  type TableOutcome,
} from 'src/features/partial-changes/assembly/outcome-rules';
import type { MergedRow } from 'src/features/partial-changes/assembly/row-merger';
import type { SystemTablePlan } from 'src/features/partial-changes/assembly/system-target-assembler';
import type {
  AssembledTarget,
  DeferredValues,
  TablePlan,
  TargetRow,
} from 'src/features/partial-changes/assembly/target-assembler';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import { compareCodePoints } from 'src/features/partial-changes/catalogue/unit-order';
import {
  isWholeDraftSelection,
  type Selection,
} from 'src/features/partial-changes/selection/selection';
import type { SelectionResolution } from 'src/features/partial-changes/selection/selection-resolution';
import type {
  ChangesBranch,
  ChangesSnapshot,
  SystemTableRows,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  type AddressedUnit,
  addressedUnitOf,
  describeMigration,
} from './catalogue-reading';
import {
  type BlockerView,
  blockerView,
  readResolvedSelection,
  unitKeyed,
} from './selection-resolving';
import {
  pairIdsOf,
  readInPlanningTransaction,
  type RowPairIds,
  tableIdOf,
} from './snapshot-reading';

export type RowTarget = RevisionSide | 'merged' | 'absent';

export type RowTargetView = RowPairIds & { readonly target: RowTarget };

export interface TablePlanView {
  readonly outcome: TableOutcome;
  readonly version?: RevisionSide;
  readonly rows: readonly RowTargetView[];
  readonly removedLinks: readonly string[];
  readonly addedLinks: readonly string[];
  readonly newRows: readonly MergedRow[];
  readonly relinkCandidate: boolean;
}

export interface SystemTablePlanView {
  readonly outcome: TableOutcome;
  readonly version?: RevisionSide;
  readonly rows: readonly string[];
  readonly removedLinks: readonly string[];
  readonly addedLinks: readonly string[];
  readonly newRows: readonly MergedRow[];
  readonly relinkCandidate: boolean;
}

export interface DeferredView {
  readonly unit: AddressedUnit;
  readonly paths: readonly string[];
  readonly structure: AddressedUnit;
}

export interface TargetView {
  readonly tableIds: readonly string[];
  readonly blockers: readonly BlockerView[];
  readonly deferred: readonly DeferredView[];
  tableOf(tableId: string): TablePlanView | undefined;
  systemTableOf(tableId: SystemTables): SystemTablePlanView | undefined;
}

const SYSTEM_ROWS_OF: Readonly<
  Record<SystemTables, (snapshot: ChangesSnapshot) => SystemTableRows>
> = {
  [SystemTables.Schema]: ({ systemRows }) => systemRows.schemas,
  [SystemTables.Migration]: ({ systemRows }) => systemRows.migrations,
  [SystemTables.Views]: ({ systemRows }) => systemRows.views,
  [SystemTables.SharedSchemas]: ({ systemRows }) => systemRows.sharedSchemas,
};

export function readAssembledTarget(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  operation: ChangeOperation,
  selection: Selection,
): Promise<TargetView> {
  return readInPlanningTransaction(kit, async () => {
    const { compared, catalogue, resolution } = await readResolvedSelection(
      kit,
      branch,
      selection,
    );
    const target = await kit.targetAssembler.assemble(
      { ...compared, catalogue },
      {
        operation,
        applied: appliedUnitsOf(resolution),
        wholeDraft: isWholeDraftSelection(selection),
      },
    );

    return targetView(compared.snapshot, catalogue, target);
  });
}

function appliedUnitsOf(resolution: SelectionResolution): Set<string> {
  if (resolution.blockers.length > 0) {
    throw new Error(
      `The selection is blocked: ${resolution.blockers.map(({ message }) => message).join('; ')}`,
    );
  }

  return new Set([...resolution.selected, ...resolution.required.keys()]);
}

function targetView(
  snapshot: ChangesSnapshot,
  catalogue: ChangeCatalogue,
  target: AssembledTarget,
): TargetView {
  const views = new Map(
    target.tables.map((plan) => [
      tableIdOf(snapshot, plan.identity),
      new TablePlanDescription(snapshot, plan).view(),
    ]),
  );
  const systemViews = new Map(
    target.systemTables.map((plan) => [
      plan.tableId,
      new SystemTablePlanDescription(
        SYSTEM_ROWS_OF[plan.tableId](snapshot),
        plan,
      ).view(),
    ]),
  );

  return {
    tableIds: [...views.keys()].sort(compareCodePoints),
    blockers: target.blockers.map((blocker) => blockerView(catalogue, blocker)),
    deferred: target.deferred.map((deferred) =>
      deferredView(catalogue, deferred),
    ),
    tableOf: (tableId) => views.get(tableId),
    systemTableOf: (tableId) => systemViews.get(tableId),
  };
}

function deferredView(
  catalogue: ChangeCatalogue,
  { unitKey, paths, structureKey }: DeferredValues,
): DeferredView {
  return {
    unit: addressedUnitOf(unitKeyed(catalogue, unitKey)),
    paths,
    structure: addressedUnitOf(unitKeyed(catalogue, structureKey)),
  };
}

class TablePlanDescription {
  private readonly otherSide: RevisionSide;
  private readonly versionNames: ReadonlyMap<string, string>;

  constructor(
    private readonly snapshot: ChangesSnapshot,
    private readonly plan: TablePlan,
  ) {
    this.otherSide = oppositeOf(plan.structureSide);
    this.versionNames = rowVersionNamesOf(plan.rows);
  }

  public view(): TablePlanView {
    const { plan } = this;

    return {
      outcome: plan.outcome,
      version: this.sideOfLinkedVersion(),
      rows: plan.rows
        .map((row) => this.rowView(row))
        .sort((left, right) =>
          compareCodePoints(pairKey(left), pairKey(right)),
        ),
      removedLinks: this.versionNamesOf(plan.removedLinks),
      addedLinks: this.versionNamesOf(plan.addedLinks),
      newRows: [...plan.newRows].sort((left, right) =>
        compareCodePoints(left.id, right.id),
      ),
      relinkCandidate: plan.relinkCandidate,
    };
  }

  private sideOfLinkedVersion(): RevisionSide | undefined {
    const { versionId } = this.plan;
    const pair = this.snapshot.tables.find(
      ({ identity }) => identity === this.plan.identity,
    );

    if (versionId === undefined) {
      return undefined;
    }

    if (pair?.head?.versionId === versionId) {
      return 'head';
    }

    if (pair?.draft?.versionId === versionId) {
      return 'draft';
    }

    throw new Error(`The plan links an unknown version ${versionId}`);
  }

  private rowView(row: TargetRow): RowTargetView {
    return { ...pairIdsOf(row.pair), target: this.targetOf(row) };
  }

  private targetOf({ kind }: TargetRow): RowTarget {
    switch (kind) {
      case 'structureSide':
        return this.plan.structureSide;
      case 'otherSide':
        return this.otherSide;
      case 'merge':
        return 'merged';
      case 'absent':
        return 'absent';
    }
  }

  private versionNamesOf(versionIds: readonly string[]): string[] {
    return versionIds
      .map((versionId) => this.versionName(versionId))
      .sort(compareCodePoints);
  }

  private versionName(versionId: string): string {
    const name = this.versionNames.get(versionId);

    if (name === undefined) {
      throw new Error(`The plan links an unknown row version ${versionId}`);
    }

    return name;
  }
}

class SystemTablePlanDescription {
  private readonly otherSide: RevisionSide;

  constructor(
    private readonly rows: SystemTableRows,
    private readonly plan: SystemTablePlan,
  ) {
    this.otherSide = oppositeOf(plan.linkSide);
  }

  public view(): SystemTablePlanView {
    const { plan } = this;

    return {
      outcome: plan.outcome,
      version: this.sideOfLinkedVersion(),
      rows: this.targetRows()
        .map((row) => describeRowOf(plan.tableId, row))
        .sort(compareCodePoints),
      removedLinks: this.namesOn(plan.linkSide, plan.removedLinks),
      addedLinks: this.namesOn(this.otherSide, plan.addedLinks),
      newRows: plan.newRows,
      relinkCandidate: plan.relinkCandidate,
    };
  }

  private sideOfLinkedVersion(): RevisionSide | undefined {
    const { versionId } = this.plan;

    if (versionId === undefined) {
      return undefined;
    }

    if (this.rows.versionIds.head === versionId) {
      return 'head';
    }

    if (this.rows.versionIds.draft === versionId) {
      return 'draft';
    }

    throw new Error(`The plan links an unknown version ${versionId}`);
  }

  private targetRows(): MergedRow[] {
    const { plan, rows } = this;

    switch (plan.outcome) {
      case 'base':
        return [...rows[plan.linkSide]];
      case 'other':
        return [...rows[this.otherSide]];
      default:
        return [
          ...rows[plan.linkSide].filter(
            ({ versionId }) => !plan.removedLinks.includes(versionId),
          ),
          ...rows[this.otherSide].filter(({ versionId }) =>
            plan.addedLinks.includes(versionId),
          ),
          ...plan.newRows,
        ];
    }
  }

  private namesOn(side: RevisionSide, versionIds: readonly string[]): string[] {
    return versionIds
      .map((versionId) => {
        const row = this.rows[side].find(
          (candidate) => candidate.versionId === versionId,
        );

        if (!row) {
          throw new Error(`The plan links an unknown system row ${versionId}`);
        }

        return `${side} ${describeRowOf(this.plan.tableId, row)}`;
      })
      .sort(compareCodePoints);
  }
}

function describeRowOf(tableId: SystemTables, row: MergedRow): string {
  switch (tableId) {
    case SystemTables.Schema:
      return `schema ${row.id}`;
    case SystemTables.Migration:
      return `migration ${describeMigration(row.data as unknown as Migration)}`;
    case SystemTables.Views:
      return `views ${row.id}`;
    case SystemTables.SharedSchemas:
      return `sharedSchema ${row.id}`;
  }
}

function rowVersionNamesOf(
  rows: readonly TargetRow[],
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();

  for (const { pair } of rows) {
    if (pair.head) {
      names.set(pair.head.versionId, `head ${pair.head.id}`);
    }

    if (pair.draft) {
      names.set(pair.draft.versionId, `draft ${pair.draft.id}`);
    }
  }

  return names;
}

function pairKey({ head, draft }: RowPairIds): string {
  return `${draft ?? head}/${head ?? ''}`;
}
