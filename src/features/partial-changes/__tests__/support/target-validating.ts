import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { closedPlanOf } from './dependency-closing';
import { type BlockerView, blockerView } from './selection-resolving';
import { readInPlanningTransaction } from './snapshot-reading';

export function readValidationBlockers(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  operation: ChangeOperation,
  selection: Selection,
): Promise<BlockerView[]> {
  return readInPlanningTransaction(kit, async () => {
    const { source, choice, target } = await closedPlanOf(
      kit,
      branch,
      operation,
      selection,
    );
    const blockers = await kit.targetValidator.validate(source, {
      choice,
      assembled: target,
    });

    return blockers.map((blocker) => blockerView(source.catalogue, blocker));
  });
}
