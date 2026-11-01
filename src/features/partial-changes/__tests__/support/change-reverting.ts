import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type {
  RevertChangesInput,
  RevertChangesResult,
} from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { ShareCommands } from 'src/features/share/share.commands';

export type RevertOptions = Omit<RevertChangesInput, 'branch'>;

export interface EndpointNotification<T> {
  readonly revisionId: string;
  readonly seenOutsideTheTransaction: T;
}

export function revertChanges(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  options: RevertOptions,
): Promise<RevertChangesResult> {
  return kit.partialChangesApi.revertChanges({ ...options, branch });
}

// Each notification records what a reader outside the operation's transaction sees at that moment.
export function recordEndpointNotifications<T>(
  kit: PartialChangesTestKit,
  readOutsideTheTransaction: () => Promise<T>,
): EndpointNotification<T>[] {
  const notifications: EndpointNotification<T>[] = [];

  jest
    .spyOn(kit.module.get(ShareCommands), 'notifyEndpoints')
    .mockImplementation(async ({ revisionId }) => {
      notifications.push({
        revisionId,
        seenOutsideTheTransaction: await readOutsideTheTransaction(),
      });
    });

  return notifications;
}
