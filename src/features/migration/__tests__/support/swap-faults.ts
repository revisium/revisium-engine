import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { SwapRecheckService } from 'src/features/migration/services/swap-recheck.service';
import { ShareCommands } from 'src/features/share/share.commands';

const CONNECTION_LOST = 'Connection terminated after the swap committed';
const NOTIFICATION_FAILED = 'The host endpoint is unavailable';

export function loseSwapCommitAcknowledgement(kit: MigrationTestKit) {
  const transactions = kit.transactionService;
  const runSerializable = transactions.runSerializable.bind(transactions);

  return jest
    .spyOn(transactions, 'runSerializable')
    .mockImplementationOnce(async (...args) => {
      await runSerializable(...args);
      throw new Error(CONNECTION_LOST);
    });
}

export function withoutLedgerAvailabilityRecheck(kit: MigrationTestKit) {
  const rechecks = kit.module.get(SwapRecheckService) as unknown as {
    ensureLedgerAvailable(): Promise<void>;
  };

  return jest
    .spyOn(rechecks, 'ensureLedgerAvailable')
    .mockResolvedValue(undefined);
}

export function failEndpointNotifications(kit: MigrationTestKit) {
  return jest
    .spyOn(kit.module.get(ShareCommands), 'notifyEndpoints')
    .mockRejectedValue(new Error(NOTIFICATION_FAILED));
}
