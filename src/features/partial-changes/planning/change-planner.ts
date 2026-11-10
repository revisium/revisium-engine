import { Injectable } from '@nestjs/common';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  type ClosureSource,
  DependencyClosure,
  type DependencyClosureResult,
} from 'src/features/partial-changes/closure/dependency-closure';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { PlanEstimate } from 'src/features/partial-changes/limits/operation-estimator';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import {
  distinctBlockers,
  ledgerInconsistentBlockerOf,
  type CatalogueBlocker,
} from 'src/features/partial-changes/plan/plan-blocker';
import { assertEveryAppliedTableRead } from 'src/features/partial-changes/planning/applied-tables-read';
import {
  coverageOf,
  type TableCoverage,
} from 'src/features/partial-changes/planning/plan-coverage';
import { PlanFingerprint } from 'src/features/partial-changes/planning/plan-fingerprint';
import {
  type PlanBlocker,
  blockerRefOf,
  type DeferredRow,
  deferredRowsOf,
  sampleOf,
} from 'src/features/partial-changes/planning/plan-refs';
import {
  type ScopedCatalogue,
  ScopedCatalogueReader,
} from 'src/features/partial-changes/scope/scoped-catalogue-reader.service';
import { readAddressedRows } from 'src/features/partial-changes/selection/addressed-rows';
import {
  isWholeDraftSelection,
  type Selection,
} from 'src/features/partial-changes/selection/selection';
import type { UnmatchedSelectors } from 'src/features/partial-changes/selection/selection-resolution';
import type {
  DescribedUnitRef,
  RequiredUnit,
} from 'src/features/partial-changes/selection/unit-refs';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  type ComparedSnapshot,
  ComparedSnapshotReader,
} from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';
import {
  type AppliedTarget,
  TargetValidator,
} from 'src/features/partial-changes/validation/target-validator';
import type { DeadlineHandle } from 'src/infrastructure/database/operation-deadline';

export interface SnapshotRequest {
  readonly branch: ChangesBranch;
  readonly selection: Selection;
}

export interface PlanRequest {
  readonly operation: ChangeOperation;
  readonly selection: Selection;
  readonly compared: ComparedSnapshot;
}

export interface PlanCounts {
  readonly selected: number;
  readonly required: number;
}

export interface PlannedTarget extends AppliedTarget {
  readonly source: AssemblySource;
}

interface PlanBase {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly refusedTables: readonly RefusedTable[];
  readonly blockers: readonly PlanBlocker[];
  readonly estimate: PlanEstimate;
}

// A plan that ran to its end.
export interface CompletePlan extends PlanBase {
  readonly planned: true;
  readonly fingerprint: string;
  readonly appliedUnits: readonly CatalogueUnit[];
  readonly counts: PlanCounts;
  readonly coverage: readonly TableCoverage[];
  readonly required: readonly RequiredUnit[];
  readonly deferred: readonly DeferredRow[];
  readonly sample: readonly DescribedUnitRef[];
  readonly unmatched: UnmatchedSelectors;
  readonly target: PlannedTarget;
}

// A plan a limit stopped (SPEC §5.3): what the closure found before the stop is not the plan, so it has no value of
// one; its blockers are the tooLarge ones and its estimate is what was measured up to the stop.
export interface StoppedPlan extends PlanBase {
  readonly planned: false;
}

export type ChangePlan = CompletePlan | StoppedPlan;

type CatalogueRead = Extract<ScopedCatalogue, { kind: 'catalogue' }>;

type CatalogueRefused = Extract<ScopedCatalogue, { kind: 'tooLarge' }>;

type ClosedResult = Extract<DependencyClosureResult, { kind: 'closed' }>;

type StoppedClosure = Extract<DependencyClosureResult, { kind: 'tooLarge' }>;

interface ValidatedClosure {
  readonly fingerprint: string;
  readonly blockers: readonly CatalogueBlocker[];
  readonly target: PlannedTarget;
}

interface ClosedSelection {
  readonly source: ClosureSource;
  readonly closure: ClosedResult;
}

interface PlanParts {
  readonly source: ClosureSource;
  readonly closure: ClosedResult;
  readonly validated: ValidatedClosure;
}

@Injectable()
export class ChangePlanner {
  constructor(
    private readonly comparedSnapshotReader: ComparedSnapshotReader,
    private readonly scopedCatalogueReader: ScopedCatalogueReader,
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly dependencyClosure: DependencyClosure,
    private readonly targetValidator: TargetValidator,
    private readonly planFingerprint: PlanFingerprint,
  ) {}

  public readComparedSnapshot({
    branch,
    selection,
  }: SnapshotRequest): Promise<ComparedSnapshot> {
    return this.comparedSnapshotReader.readComparedSnapshot(branch, {
      wholeDraft: isWholeDraftSelection(selection),
    });
  }

  public async plan(
    request: PlanRequest,
    deadline: DeadlineHandle,
  ): Promise<ChangePlan> {
    await deadline.checkpoint();

    const scoped = await this.scopedCatalogueReader.readCatalogue(
      request.compared,
      request.selection,
    );

    if (scoped.kind === 'tooLarge') {
      return planStoppedBeforeCatalogue(request.compared, scoped);
    }

    await deadline.checkpoint();

    const source = await this.closureSourceOf(request, scoped);
    const closure = await this.dependencyClosure.close(
      source,
      request,
      deadline,
    );

    assertEveryAppliedTableRead(source, closure.applied);

    if (closure.kind === 'tooLarge') {
      return planStoppedInClosure(source, closure);
    }

    const validated = await this.validateAndFingerprint(
      request,
      { source, closure },
      deadline,
    );

    return planOf({ source, closure, validated });
  }

  private async closureSourceOf(
    { compared, selection }: PlanRequest,
    { catalogue, changedRowCount }: CatalogueRead,
  ): Promise<ClosureSource> {
    return {
      ...compared,
      catalogue,
      changedRowCount,
      addressedRows: await readAddressedRows(
        this.snapshotReader,
        compared.snapshot,
        selection,
      ),
    };
  }

  private async validateAndFingerprint(
    { operation, selection }: PlanRequest,
    { source, closure }: ClosedSelection,
    deadline: DeadlineHandle,
  ): Promise<ValidatedClosure> {
    await deadline.checkpoint();

    const target: PlannedTarget = {
      source,
      choice: {
        operation,
        applied: closure.applied,
        wholeDraft: isWholeDraftSelection(selection),
      },
      assembled: closure.target,
    };
    const blockers = await this.targetValidator.validate(source, target);

    await deadline.checkpoint();

    const fingerprint = await this.planFingerprint.fingerprintOf({
      ...target.choice,
      snapshot: source.snapshot,
      catalogue: source.catalogue,
    });

    return { fingerprint, blockers, target };
  }
}

function planOf({ source, closure, validated }: PlanParts): CompletePlan {
  const { snapshot, catalogue, headSchema } = source;
  const appliedUnits = catalogue.units.filter(({ key }) =>
    closure.applied.has(key),
  );
  const blockers = distinctBlockers([
    ...closure.blockers,
    ...validated.blockers,
    ...catalogue.ledgerInconsistencies.map(ledgerInconsistentBlockerOf),
  ]);

  return {
    planned: true,
    headRevisionId: snapshot.headRevisionId,
    draftRevisionId: snapshot.draftRevisionId,
    fingerprint: validated.fingerprint,
    appliedUnits,
    counts: countsOf(closure),
    coverage: coverageOf(catalogue, closure.applied),
    refusedTables: headSchema.refusedTables,
    required: closure.required,
    blockers: blockers.map((blocker) => blockerRefOf(catalogue, blocker)),
    deferred: deferredRowsOf(catalogue, validated.target.assembled.deferred),
    sample: sampleOf(catalogue, appliedUnits),
    unmatched: closure.unmatched,
    estimate: closure.estimate,
    target: validated.target,
  };
}

function countsOf({ selected, required }: ClosedResult): PlanCounts {
  return { selected: selected.size, required: required.length };
}

// The closure also carries the blockers of the selection it resolved; a stopped plan returns only the limit's.
function planStoppedInClosure(
  { snapshot, catalogue, headSchema }: ClosureSource,
  { blockers, estimate }: StoppedClosure,
): StoppedPlan {
  return {
    planned: false,
    headRevisionId: snapshot.headRevisionId,
    draftRevisionId: snapshot.draftRevisionId,
    refusedTables: headSchema.refusedTables,
    blockers: blockers
      .filter(({ code }) => code === 'tooLarge')
      .map((blocker) => blockerRefOf(catalogue, blocker)),
    estimate,
  };
}

function planStoppedBeforeCatalogue(
  { snapshot, headSchema }: ComparedSnapshot,
  { changedRowCount, blocker }: CatalogueRefused,
): StoppedPlan {
  return {
    planned: false,
    headRevisionId: snapshot.headRevisionId,
    draftRevisionId: snapshot.draftRevisionId,
    refusedTables: headSchema.refusedTables,
    blockers: [blocker],
    estimate: {
      changedRows: changedRowCount,
      mergedRows: 0,
      perRowWorkRows: 0,
      mixedTables: [],
    },
  };
}
