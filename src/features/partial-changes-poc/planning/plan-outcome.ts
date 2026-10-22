import { BadRequestException } from '@nestjs/common';
import {
  compareUnits,
  toPublicUnit,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import {
  ApplyChangesResult,
  Blocker,
  PreviewChangesResult,
  PreviewStatus,
  PublicUnit,
  RenumberedMigrationId,
  RequiredUnit,
  UnitCounts,
} from 'src/features/partial-changes-poc/partial-changes.types';
import { ChangePlan } from 'src/features/partial-changes-poc/planning/change-planner.service';
import { hasUnmatched } from 'src/features/partial-changes-poc/selection/resolve-selection';

const SAMPLE_SIZE = 20;

export function planStatus(
  plan: ChangePlan,
  includeRequired: boolean,
): PreviewStatus {
  if (plan.applied.size === 0 && plan.blockers.length === 0) {
    return 'empty';
  }

  if (plan.blockers.length > 0 || hasUnmatched(plan.unmatched)) {
    return 'blocked';
  }

  if (plan.required.size > 0 && !includeRequired) {
    return 'required';
  }

  return 'ready';
}

export function planCounts(plan: ChangePlan): UnitCounts {
  return {
    selected: plan.selected.size,
    required: plan.required.size,
    remaining: plan.catalogue.units.size - plan.applied.size,
  };
}

export function planBlockers(plan: ChangePlan): Blocker[] {
  if (!hasUnmatched(plan.unmatched)) {
    return plan.blockers;
  }
  return [
    ...plan.blockers,
    {
      code: 'unmatchedSelector',
      message: `Some selectors match no change: ${JSON.stringify(plan.unmatched)}`,
    },
  ];
}

export function requiredUnits(plan: ChangePlan): RequiredUnit[] {
  return [...plan.required].flatMap(([key, reason]) => {
    const unit = plan.catalogue.units.get(key);
    return unit ? [{ unit: toPublicUnit(unit), reason }] : [];
  });
}

export function appliedSample(plan: ChangePlan): PublicUnit[] {
  return [...plan.applied]
    .map((key) => plan.catalogue.units.get(key))
    .filter((unit) => unit !== undefined)
    .sort(compareUnits)
    .slice(0, SAMPLE_SIZE)
    .map(toPublicUnit);
}

export function toPreviewResult(
  plan: ChangePlan,
  includeRequired: boolean,
): PreviewChangesResult {
  return {
    status: planStatus(plan, includeRequired),
    fingerprint: plan.fingerprint,
    counts: planCounts(plan),
    required: requiredUnits(plan),
    blockers: planBlockers(plan),
    deferred: plan.target.deferred,
    sample: appliedSample(plan),
    unmatched: plan.unmatched,
    estimate: plan.estimate,
  };
}

export function refusalOf(
  plan: ChangePlan,
  options: { includeRequired?: boolean; expected?: string },
): ApplyChangesResult | undefined {
  const status = planStatus(plan, Boolean(options.includeRequired));

  if (status === 'empty') {
    return {
      status: 'empty',
      headRevisionId: plan.snapshot.headRevisionId,
      draftRevisionId: plan.snapshot.draftRevisionId,
      ...unmatchedOf(plan),
    };
  }

  if (options.expected !== undefined && options.expected !== plan.fingerprint) {
    return { status: 'stale' };
  }

  if (status === 'blocked') {
    return {
      status: 'blocked',
      blockers: planBlockers(plan),
      required: requiredUnits(plan),
      ...unmatchedOf(plan),
    };
  }

  if (status === 'required') {
    return { status: 'required', required: requiredUnits(plan) };
  }

  return undefined;
}

function unmatchedOf(plan: ChangePlan): Pick<ApplyChangesResult, 'unmatched'> {
  return hasUnmatched(plan.unmatched) ? { unmatched: plan.unmatched } : {};
}

export function rejectUnreviewedRequired(input: {
  includeRequired?: boolean;
  expected?: string;
}): void {
  if (input.includeRequired && input.expected === undefined) {
    throw new BadRequestException(
      'includeRequired needs expected: preview the selection and pass its fingerprint',
    );
  }
}

export function appliedCounts(
  plan: ChangePlan,
): Pick<ApplyChangesResult, 'applied' | 'remaining'> {
  const counts = planCounts(plan);
  return {
    applied: { selected: counts.selected, required: counts.required },
    remaining: { units: counts.remaining },
  };
}

export function renumberedIds(plan: ChangePlan): RenumberedMigrationId[] {
  return plan.ledger.renumbered.map(({ source, migration }) => ({
    from: source.id,
    to: migration.id,
  }));
}
