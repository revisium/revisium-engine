import { Inject, Injectable } from '@nestjs/common';
import type {
  AppliedUnits,
  ChangeOperation,
} from 'src/features/partial-changes/assembly/outcome-rules';
import {
  type AssembledTarget,
  TargetAssembler,
} from 'src/features/partial-changes/assembly/target-assembler';
import {
  danglingInSource,
  type Finding,
  TARGET_CHECKS,
  type TargetCheck,
  type TargetChecking,
} from 'src/features/partial-changes/closure/findings';
import {
  type Estimate,
  type OperationEstimation,
  OperationEstimator,
} from 'src/features/partial-changes/limits/operation-estimator';
import { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import {
  isWholeDraftSelection,
  type Selection,
} from 'src/features/partial-changes/selection/selection';
import type {
  PlanBlocker,
  Reason,
  SelectionResolution,
  SelectionSource,
  UnmatchedSelection,
} from 'src/features/partial-changes/selection/selection-resolution';
import {
  distinctBlockers,
  requiredExcluded,
  resolveSelection,
} from 'src/features/partial-changes/selection/selection-resolver';
import {
  type RequiredUnit,
  requiredUnitsOf,
} from 'src/features/partial-changes/selection/unit-refs';
import type { DeadlineHandle } from 'src/infrastructure/database/operation-deadline';

export interface ClosureSource extends SelectionSource {
  readonly changedRowCount: number;
}

export interface ClosureRequest {
  readonly operation: ChangeOperation;
  readonly selection: Selection;
}

interface ClosureOutcome {
  readonly selected: ReadonlySet<string>;
  readonly unmatched: UnmatchedSelection;
  readonly applied: ReadonlySet<string>;
  readonly required: readonly RequiredUnit[];
  readonly blockers: readonly PlanBlocker[];
  readonly estimate: Estimate;
}

export type DependencyClosureResult =
  | (ClosureOutcome & {
      readonly kind: 'closed';
      readonly target: AssembledTarget;
    })
  | (ClosureOutcome & { readonly kind: 'tooLarge' });

interface ClosureSteps {
  readonly deadline: DeadlineHandle;
  readonly estimation: OperationEstimation;
  readonly assembler: TargetAssembler;
  readonly checks: readonly TargetChecking[];
}

@Injectable()
export class DependencyClosure {
  constructor(
    private readonly estimator: OperationEstimator,
    private readonly assembler: TargetAssembler,
    @Inject(TARGET_CHECKS) private readonly checks: readonly TargetCheck[],
  ) {}

  public close(
    source: ClosureSource,
    request: ClosureRequest,
    deadline: DeadlineHandle,
  ): Promise<DependencyClosureResult> {
    return new SelectionClosure(
      source,
      request,
      resolveSelection(request.selection, source),
      {
        deadline,
        estimation: this.estimator.estimationOf(source),
        assembler: this.assembler,
        checks: this.checks.map((check) => check.checkingOf(source)),
      },
    ).close();
  }
}

class SelectionClosure {
  private readonly lookup: CatalogueLookup;
  private readonly applied: Set<string>;
  private readonly required: Map<string, Reason>;

  constructor(
    private readonly source: ClosureSource,
    private readonly request: ClosureRequest,
    private readonly resolution: SelectionResolution,
    private readonly steps: ClosureSteps,
  ) {
    this.lookup = new CatalogueLookup(source.catalogue);
    this.applied = new Set([
      ...resolution.selected,
      ...resolution.required.keys(),
    ]);
    this.required = new Map(resolution.required);
  }

  public async close(): Promise<DependencyClosureResult> {
    await this.steps.deadline.checkpoint();

    const choice = this.appliedUnits();
    const guarded = await this.steps.estimation.estimateAndGuard(choice);

    if (guarded.kind === 'tooLarge') {
      return {
        ...this.outcomeWith(guarded.estimate, guarded.blockers),
        kind: 'tooLarge',
      };
    }

    const target = await this.steps.assembler.assemble(this.source, choice);
    const findings = await this.findingsOf(target, choice);

    if (this.addRequiredUnits(findings)) {
      return this.close();
    }

    return {
      ...this.outcomeWith(guarded.estimate, [
        ...target.blockers,
        ...findings.map((finding) => this.blockerOf(finding)),
      ]),
      kind: 'closed',
      target,
    };
  }

  private appliedUnits(): AppliedUnits {
    return {
      operation: this.request.operation,
      applied: this.applied,
      wholeDraft: isWholeDraftSelection(this.request.selection),
    };
  }

  private async findingsOf(
    target: AssembledTarget,
    choice: AppliedUnits,
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const check of this.steps.checks) {
      findings.push(...(await check.findingsOf(target, choice)));
    }

    return findings;
  }

  private addRequiredUnits(findings: readonly Finding[]): boolean {
    const appliedBefore = this.applied.size;

    for (const finding of findings) {
      if (finding.kind === 'requires' && this.canAdd(finding.unitKey)) {
        this.applied.add(finding.unitKey);
        this.required.set(finding.unitKey, finding.reason);
      }
    }

    return this.applied.size > appliedBefore;
  }

  private canAdd(unitKey: string): boolean {
    return !this.resolution.excluded.has(unitKey) && !this.applied.has(unitKey);
  }

  private blockerOf(finding: Finding): PlanBlocker {
    if (finding.kind === 'blocks') {
      return finding.blocker;
    }

    const { unitKey, reason } = finding;

    if (this.resolution.excluded.has(unitKey)) {
      return requiredExcluded(this.lookup.unit(unitKey), reason);
    }

    return danglingInSource(reason.because, reason, unitKey);
  }

  private outcomeWith(
    estimate: Estimate,
    blockers: readonly PlanBlocker[],
  ): ClosureOutcome {
    return {
      selected: this.resolution.selected,
      unmatched: this.resolution.unmatched,
      applied: this.applied,
      required: requiredUnitsOf(this.source.catalogue, this.required),
      blockers: distinctBlockers([...this.resolution.blockers, ...blockers]),
      estimate,
    };
  }
}
