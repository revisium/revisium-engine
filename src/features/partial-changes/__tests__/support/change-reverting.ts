import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type {
  RevertChangesInput,
  RevertChangesResult,
} from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';

export type RevertOptions = Omit<RevertChangesInput, 'branch'>;

export function revertChanges(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  options: RevertOptions,
): Promise<RevertChangesResult> {
  return kit.partialChangesApi.revertChanges({ ...options, branch });
}
