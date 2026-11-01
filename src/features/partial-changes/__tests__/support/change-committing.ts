import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type {
  CommitChangesInput,
  CommitChangesResult,
} from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';

export type CommitOptions = Omit<CommitChangesInput, 'branch'>;

export function commitChanges(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  options: CommitOptions,
): Promise<CommitChangesResult> {
  return kit.partialChangesApi.commitChanges({ ...options, branch });
}
