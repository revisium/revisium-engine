import type { TestingModule } from '@nestjs/testing';
import { ShareCommands } from 'src/features/share/share.commands';

export interface EndpointNotification<T> {
  readonly revisionId: string;
  readonly seenOutsideTheTransaction: T;
}

// Each notification records what a reader outside the operation's transaction sees at that moment.
export function recordEndpointNotifications<T>(
  kit: { readonly module: TestingModule },
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
