import { Injectable } from '@nestjs/common';
import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import type {
  AssemblySource,
  DeferredValues,
} from 'src/features/partial-changes/assembly/target-assembler';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ComparedSnapshot } from 'src/features/partial-changes/catalogue/change-catalogue';
import { ledgerInconsistentBlockerOf } from 'src/features/partial-changes/catalogue/ledger-inconsistency';
import {
  type ClosureSource,
  DependencyClosure,
  type DependencyClosureResult,
} from 'src/features/partial-changes/closure/dependency-closure';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { Estimate } from 'src/features/partial-changes/limits/operation-estimator';
import { assertEveryAppliedTableRead } from 'src/features/partial-changes/planning/applied-tables-read';
import { PlanFingerprint } from 'src/features/partial-changes/planning/plan-fingerprint';
import {
  type Blocker,
  blockerRefOf,
  type Deferred,
  deferredRefOf,
} from 'src/features/partial-changes/planning/plan-refs';
import {
  type ScopedCatalogue,
  ScopedCatalogueReader,
} from 'src/features/partial-changes/scope/scoped-catalogue-reader.service';
import { readAddressedRows } from 'src/features/partial-changes/selection/addressed-rows';
import { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import {
  isWholeDraftSelection,
  type Selection,
} from 'src/features/partial-changes/selection/selection';
import type {
  PlanBlocker,
  UnmatchedSelection,
} from 'src/features/partial-changes/selection/selection-resolution';
import { distinctBlockers } from 'src/features/partial-changes/selection/selection-resolver';
import type { RequiredUnit } from 'src/features/partial-changes/selection/unit-refs';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { ComparedSnapshotReader } from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';
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

export interface Counts {
  readonly selected: number;
  readonly required: number;
  readonly remaining: number;
}

export interface PlannedTarget extends AppliedTarget {
  readonly source: AssemblySource;
}

export interface ChangePlan {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly refusedByLimit: boolean;
  readonly fingerprint: string;
  readonly appliedUnits: readonly CatalogueUnit[];
  readonly counts: Counts;
  readonly unreadTables: number;
  readonly refusedTables: readonly RefusedTable[];
  readonly required: readonly RequiredUnit[];
  readonly blockers: readonly Blocker[];
  readonly deferred: readonly Deferred[];
  readonly unmatched: UnmatchedSelection;
  readonly estimate: Estimate;
  readonly target?: PlannedTarget;
}

type CatalogueRead = Extract<ScopedCatalogue, { kind: 'catalogue' }>;

type CatalogueRefused = Extract<ScopedCatalogue, { kind: 'tooLarge' }>;

interface ValidatedClosure {
  readonly fingerprint: string;
  readonly blockers: readonly PlanBlocker[];
  readonly target?: PlannedTarget;
}

interface ClosedSelection {
  readonly source: ClosureSource;
  readonly closure: DependencyClosureResult;
}

interface PlanParts {
  readonly source: ClosureSource;
  readonly unreadTables: number;
  readonly closure: DependencyClosureResult;
  readonly validated: ValidatedClosure;
}

const REFUSED_FINGERPRINT = '';

const REFUSED_BY_LIMIT: ValidatedClosure = {
  fingerprint: REFUSED_FINGERPRINT,
  blockers: [],
};

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
      return planRefusedBeforeCatalogue(request.compared, scoped);
    }

    await deadline.checkpoint();

    const source = await this.closureSourceOf(request, scoped);
    const closure = await this.dependencyClosure.close(
      source,
      request,
      deadline,
    );

    assertEveryAppliedTableRead(source, closure.applied);

    const validated = await this.validateAndFingerprint(
      request,
      { source, closure },
      deadline,
    );

    return planOf({
      source,
      unreadTables: scoped.unreadTables,
      closure,
      validated,
    });
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
    if (closure.kind === 'tooLarge') {
      return REFUSED_BY_LIMIT;
    }

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
      operation,
      snapshot: source.snapshot,
      catalogue: source.catalogue,
      applied: closure.applied,
    });

    return { fingerprint, blockers, target };
  }
}

function planOf({
  source,
  unreadTables,
  closure,
  validated,
}: PlanParts): ChangePlan {
  const { snapshot, catalogue, headSchema } = source;
  const lookup = new CatalogueLookup(catalogue);
  const appliedUnits = catalogue.units.filter(({ key }) =>
    closure.applied.has(key),
  );
  const blockers = distinctBlockers([
    ...closure.blockers,
    ...validated.blockers,
    ...catalogue.ledgerInconsistencies.map(ledgerInconsistentBlockerOf),
  ]);

  return {
    headRevisionId: snapshot.headRevisionId,
    draftRevisionId: snapshot.draftRevisionId,
    refusedByLimit: closure.kind === 'tooLarge',
    fingerprint: validated.fingerprint,
    appliedUnits,
    counts: countsOf(closure, catalogue.units.length - appliedUnits.length),
    unreadTables,
    refusedTables: headSchema.refusedTables,
    required: closure.required,
    blockers: blockers.map((blocker) => blockerRefOf(lookup, blocker)),
    deferred: deferredValuesOf(validated).map((deferred) =>
      deferredRefOf(lookup, deferred),
    ),
    unmatched: closure.unmatched,
    estimate: closure.estimate,
    target: validated.target,
  };
}

function countsOf(
  { selected, required }: DependencyClosureResult,
  remaining: number,
): Counts {
  return { selected: selected.size, required: required.length, remaining };
}

function deferredValuesOf({
  target,
}: ValidatedClosure): readonly DeferredValues[] {
  return target?.assembled.deferred ?? [];
}

function planRefusedBeforeCatalogue(
  { snapshot, headSchema }: ComparedSnapshot,
  { changedRowCount, unreadTables, blocker }: CatalogueRefused,
): ChangePlan {
  return {
    headRevisionId: snapshot.headRevisionId,
    draftRevisionId: snapshot.draftRevisionId,
    refusedByLimit: true,
    fingerprint: REFUSED_FINGERPRINT,
    appliedUnits: [],
    counts: { selected: 0, required: 0, remaining: 0 },
    unreadTables,
    refusedTables: headSchema.refusedTables,
    required: [],
    blockers: [blocker],
    deferred: [],
    unmatched: {},
    estimate: {
      changedRows: changedRowCount,
      mergedRows: 0,
      perRowWorkRows: 0,
      mixedTables: [],
    },
  };
}
