import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import type { FingerprintedPlan } from 'src/features/partial-changes/planning/plan-fingerprint';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { closedPlanOf } from './dependency-closing';
import { readInPlanningTransaction } from './snapshot-reading';

export type PlanVariant = (plan: FingerprintedPlan) => FingerprintedPlan;

const AS_PLANNED: PlanVariant = (plan) => plan;

export function readPlanFingerprint(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  operation: ChangeOperation,
  selection: Selection,
  variant: PlanVariant = AS_PLANNED,
): Promise<string> {
  return readInPlanningTransaction(kit, async () => {
    const { source, choice } = await closedPlanOf(
      kit,
      branch,
      operation,
      selection,
    );

    return kit.planFingerprint.fingerprintOf(
      variant({
        operation,
        snapshot: source.snapshot,
        catalogue: source.catalogue,
        applied: choice.applied,
      }),
    );
  });
}
