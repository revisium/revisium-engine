import { Injectable } from '@nestjs/common';
import type { Migration } from '@revisium/schema-toolkit/types';
import {
  type AppliedUnits,
  OutcomeRules,
} from 'src/features/partial-changes/assembly/outcome-rules';
import { ownersByVersionId } from 'src/features/partial-changes/assembly/system-table-targets';
import type { AssembledTarget } from 'src/features/partial-changes/assembly/target-assembler';
import {
  type CheckSource,
  type Finding,
  requiring,
  type TargetCheck,
  type TargetChecking,
} from 'src/features/partial-changes/closure/findings';
import { TableIdTimeline } from 'src/features/partial-changes/closure/table-id-timeline';
import type { Reason } from 'src/features/partial-changes/selection/selection-resolution';
import { readTableIdsByStep } from 'src/features/partial-changes/validation/ledger-consistency';
import {
  type ResultingRole,
  resultingRolesOf,
  sourceRoleOf,
} from 'src/features/partial-changes/validation/ledger-roles';
import { ledgerOf } from 'src/features/share/ledger/migration-ledger';
import { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';

type TableIdNeed = 'referenced' | 'taken';

interface TableIdStep {
  readonly migration: Migration;
  readonly tableId: string;
  readonly need: TableIdNeed;
}

@Injectable()
export class LedgerDependencyChecks implements TargetCheck {
  constructor(private readonly replayer: LedgerReplayer) {}

  public checkingOf(source: CheckSource): TargetChecking {
    return new LedgerDependencyChecking(source, this.replayer);
  }
}

class LedgerDependencyChecking implements TargetChecking {
  private readonly draftLedger: TableIdTimeline;
  private readonly owners: ReadonlyMap<string, string>;
  private readonly unitsWithPendingMigrations: ReadonlySet<string>;
  private readonly dependentStepsByLedger = new Map<
    string,
    readonly TableIdStep[]
  >();

  constructor(
    private readonly source: CheckSource,
    private readonly replayer: LedgerReplayer,
  ) {
    this.draftLedger = new TableIdTimeline(
      sourceRoleOf(source.snapshot, 'draft').ledger,
    );
    this.owners = pendingMigrationOwnersOf(source);
    this.unitsWithPendingMigrations = new Set(this.owners.values());
  }

  public findingsOf(
    _target: AssembledTarget,
    choice: AppliedUnits,
  ): Promise<Finding[]> {
    const rules = new OutcomeRules(choice);

    if (!this.movesPendingMigrations(rules)) {
      return Promise.resolve([]);
    }

    return Promise.resolve(
      resultingRolesOf(this.source, choice).flatMap((role) =>
        this.dependentStepsOf(role.ledger).flatMap((step) =>
          this.requirementsOf(step, role, rules),
        ),
      ),
    );
  }

  private movesPendingMigrations(rules: OutcomeRules): boolean {
    return [...this.unitsWithPendingMigrations].some((unit) =>
      rules.isApplied(unit),
    );
  }

  private dependentStepsOf(
    ledger: readonly Migration[],
  ): readonly TableIdStep[] {
    const key = JSON.stringify(ledger);
    let steps = this.dependentStepsByLedger.get(key);

    if (!steps) {
      steps = this.stepsFailingOnlyIn(ledger);
      this.dependentStepsByLedger.set(key, steps);
    }

    return steps;
  }

  private stepsFailingOnlyIn(ledger: readonly Migration[]): TableIdStep[] {
    const resulting = new TableIdTimeline(ledger);

    return [
      ...this.referencesOf(ledger),
      ...ledger.flatMap(tableIdTakenBy),
    ].filter(
      (step) => failsOn(resulting, step) && !failsOn(this.draftLedger, step),
    );
  }

  private referencesOf(ledger: readonly Migration[]): TableIdStep[] {
    const reads = readTableIdsByStep(this.replayer.replay(ledger));

    return ledger.flatMap((migration) =>
      (reads.get(migration.id) ?? []).map(
        (tableId): TableIdStep => ({ migration, tableId, need: 'referenced' }),
      ),
    );
  }

  private requirementsOf(
    step: TableIdStep,
    role: ResultingRole,
    rules: OutcomeRules,
  ): Finding[] {
    const stepUnit = this.owners.get(step.migration.id);

    if (stepUnit === undefined) {
      return [];
    }

    if (!rules.isApplied(stepUnit)) {
      return [requiring(stepUnit, reasonForStepUnit(step, role))];
    }

    const provider = this.providerOf(step);

    if (provider === undefined) {
      return [];
    }

    return [requiring(provider, reasonForProvider(step, role))];
  }

  private providerOf({ migration, tableId }: TableIdStep): string | undefined {
    const change = this.draftLedger.lastChangeBefore(migration, tableId);

    if (!change) {
      return undefined;
    }

    return this.owners.get(change.migration.id);
  }
}

function pendingMigrationOwnersOf({
  snapshot,
  catalogue,
}: CheckSource): ReadonlyMap<string, string> {
  const owners = ownersByVersionId(catalogue.units, 'structure');
  const migrationOwners = new Map<string, string>();

  for (const { row, migration } of ledgerOf(
    snapshot.systemRows.migrations.draft,
  )) {
    const owner = owners.get(row.versionId);

    if (owner !== undefined) {
      migrationOwners.set(migration.id, owner);
    }
  }

  return migrationOwners;
}

function tableIdTakenBy(migration: Migration): TableIdStep[] {
  switch (migration.changeType) {
    case 'init':
      return [{ migration, tableId: migration.tableId, need: 'taken' }];
    case 'rename':
      return [{ migration, tableId: migration.nextTableId, need: 'taken' }];
    case 'update':
    case 'remove':
      return [];
  }
}

function failsOn(timeline: TableIdTimeline, step: TableIdStep): boolean {
  return (
    timeline.holdsBefore(step.migration, step.tableId) ===
    (step.need === 'taken')
  );
}

function reasonForStepUnit(step: TableIdStep, role: ResultingRole): Reason {
  if (step.need === 'taken') {
    return idOccupiedOf(step, role);
  }

  return referenceOf(step, role, 'referrerStillReferences');
}

function reasonForProvider(step: TableIdStep, role: ResultingRole): Reason {
  if (step.need === 'taken') {
    return idOccupiedOf(step, role);
  }

  return referenceOf(step, role, 'referencedTableMissing');
}

function referenceOf(
  { migration, tableId }: TableIdStep,
  { name }: ResultingRole,
  code: 'referrerStillReferences' | 'referencedTableMissing',
): Reason {
  return {
    code,
    tableId: migration.tableId,
    because: `${migrationOf(migration)} references the table ${tableId}, which the ${name} ledger does not hold at that step`,
  };
}

function idOccupiedOf(
  { migration, tableId }: TableIdStep,
  { name }: ResultingRole,
): Reason {
  return {
    code: 'idOccupied',
    tableId,
    because: `${migrationOf(migration)} takes the table id ${tableId}, which the ${name} ledger already holds at that step`,
  };
}

function migrationOf({ id, tableId }: Migration): string {
  return `the migration ${id} of ${tableId}`;
}
