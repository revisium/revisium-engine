import { Injectable } from '@nestjs/common';
import type { Migration } from '@revisium/schema-toolkit/types';
import type { OutcomeRules } from 'src/features/partial-changes/assembly/outcome-rules';
import { ownersByVersionId } from 'src/features/partial-changes/assembly/system-table-targets';
import type {
  CheckContext,
  TargetCheck,
  TargetChecking,
} from 'src/features/partial-changes/closure/check-context';
import {
  type CheckSource,
  type Finding,
  requiring,
} from 'src/features/partial-changes/closure/findings';
import { TableIdTimeline } from 'src/features/partial-changes/closure/table-id-timeline';
import type { Reason } from 'src/features/partial-changes/plan/reason';
import {
  LedgerConsistency,
  lineageOf,
  readTableIdsByStep,
  type SourceInconsistencies,
} from 'src/features/partial-changes/validation/ledger-consistency';
import {
  type ResultingRole,
  resultingRolesOf,
  sourceRoleOf,
} from 'src/features/partial-changes/validation/ledger-roles';
import { ledgerOf } from 'src/features/share/ledger/migration-ledger';
import type { ReplayedLedger } from 'src/features/share/ledger-replay/ledger-replay';
import { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';

type TableIdDependency = 'missing' | 'anotherTable' | 'occupied';

interface DependentStep {
  readonly migration: Migration;
  readonly tableId: string;
  readonly dependency: TableIdDependency;
}

interface ResultingLedger {
  readonly replayed: ReplayedLedger;
  readonly dependentSteps: readonly DependentStep[];
  readonly lineagesByStep: ReadonlyMap<string, string>;
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
  private readonly resultingLedgers = new Map<string, ResultingLedger>();
  private sourceInconsistencies?: SourceInconsistencies;

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

  public findingsOf({
    target,
    choice,
    rules,
  }: CheckContext): Promise<Finding[]> {
    if (!this.movesPendingMigrations(rules)) {
      return Promise.resolve([]);
    }

    return Promise.resolve(
      resultingRolesOf(this.source, choice, target.ledger).flatMap((role) =>
        this.reportedDependentStepsOf(role).flatMap((step) =>
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

  private reportedDependentStepsOf(role: ResultingRole): DependentStep[] {
    const { replayed, dependentSteps, lineagesByStep } = this.resultingLedgerOf(
      role.ledger,
    );
    const reported = new Set(
      this.inconsistenciesOfSource()
        .newInconsistenciesOf({ ...role, replayed })
        .map(({ lineage }) => lineage),
    );

    return dependentSteps.filter(({ migration }) => {
      const lineage = lineagesByStep.get(migration.id);

      return lineage !== undefined && reported.has(lineage);
    });
  }

  private inconsistenciesOfSource(): SourceInconsistencies {
    this.sourceInconsistencies ??= new LedgerConsistency(
      this.replayer,
    ).sourceInconsistenciesOf(this.source.snapshot);

    return this.sourceInconsistencies;
  }

  private resultingLedgerOf(ledger: readonly Migration[]): ResultingLedger {
    const key = JSON.stringify(ledger);
    let resulting = this.resultingLedgers.get(key);

    if (!resulting) {
      resulting = this.replayResultingLedger(ledger);
      this.resultingLedgers.set(key, resulting);
    }

    return resulting;
  }

  private replayResultingLedger(ledger: readonly Migration[]): ResultingLedger {
    const replayed = this.replayer.replay(ledger);

    return {
      replayed,
      dependentSteps: new DependentSteps(
        this.draftLedger,
        new TableIdTimeline(ledger),
        readTableIdsByStep(replayed),
      ).of(ledger),
      lineagesByStep: lineagesByStepOf(replayed),
    };
  }

  private requirementsOf(
    step: DependentStep,
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

  private providerOf({
    migration,
    tableId,
  }: DependentStep): string | undefined {
    const change = this.draftLedger.lastChangeBefore(migration, tableId);

    if (!change) {
      return undefined;
    }

    return this.owners.get(change.migration.id);
  }
}

class DependentSteps {
  constructor(
    private readonly draftLedger: TableIdTimeline,
    private readonly resulting: TableIdTimeline,
    private readonly reads: ReadonlyMap<string, readonly string[]>,
  ) {}

  public of(ledger: readonly Migration[]): DependentStep[] {
    return ledger.flatMap((migration) => [
      ...this.referencesOf(migration).flatMap((tableId) =>
        this.referenceDependencyOf(migration, tableId),
      ),
      ...takenTableIdsOf(migration).flatMap((tableId) =>
        this.takenIdDependencyOf(migration, tableId),
      ),
    ]);
  }

  private referencesOf(migration: Migration): readonly string[] {
    if (migration.changeType !== 'init' && migration.changeType !== 'update') {
      return [];
    }

    return this.reads.get(migration.id) ?? [];
  }

  private referenceDependencyOf(
    migration: Migration,
    tableId: string,
  ): DependentStep[] {
    const meant = this.draftLedger.lastChangeBefore(
      migration,
      tableId,
    )?.lineage;
    const found = this.resulting.lastChangeBefore(migration, tableId)?.lineage;

    if (meant === undefined || found === meant) {
      return [];
    }

    if (found === undefined) {
      return [{ migration, tableId, dependency: 'missing' }];
    }

    return [{ migration, tableId, dependency: 'anotherTable' }];
  }

  private takenIdDependencyOf(
    migration: Migration,
    tableId: string,
  ): DependentStep[] {
    const heldInDraft = this.draftLedger.lastChangeBefore(migration, tableId);
    const held = this.resulting.lastChangeBefore(migration, tableId);

    if (heldInDraft?.lineage !== undefined || held?.lineage === undefined) {
      return [];
    }

    return [{ migration, tableId, dependency: 'occupied' }];
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

function lineagesByStepOf({ slots }: ReplayedLedger): Map<string, string> {
  const lineages = new Map<string, string>();

  for (const slot of slots) {
    for (const { id } of slot.migrations) {
      lineages.set(id, lineageOf(slot));
    }
  }

  return lineages;
}

function takenTableIdsOf(migration: Migration): string[] {
  switch (migration.changeType) {
    case 'init':
      return [migration.tableId];
    case 'rename':
      return [migration.nextTableId];
    case 'update':
    case 'remove':
      return [];
  }
}

function reasonForStepUnit(step: DependentStep, role: ResultingRole): Reason {
  if (step.dependency === 'occupied') {
    return idOccupiedOf(step, role);
  }

  return referenceOf(step, role, 'referrerStillReferences');
}

function reasonForProvider(step: DependentStep, role: ResultingRole): Reason {
  if (step.dependency === 'occupied') {
    return idOccupiedOf(step, role);
  }

  return referenceOf(step, role, 'referencedTableMissing');
}

function referenceOf(
  { migration, tableId, dependency }: DependentStep,
  { name }: ResultingRole,
  code: 'referrerStillReferences' | 'referencedTableMissing',
): Reason {
  return {
    code,
    tableId: migration.tableId,
    because: `${migrationOf(migration)} references the table ${tableId}, ${whichIsReferenced(dependency, name)}`,
  };
}

function whichIsReferenced(
  dependency: TableIdDependency,
  roleName: string,
): string {
  if (dependency === 'anotherTable') {
    return `which is another table in the ${roleName} ledger at that step`;
  }

  return `which the ${roleName} ledger does not hold at that step`;
}

function idOccupiedOf(
  { migration, tableId }: DependentStep,
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
