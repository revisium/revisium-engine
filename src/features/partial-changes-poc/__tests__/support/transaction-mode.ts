import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export async function transactionReadOnlyDuring(
  kit: PartialChangesTestKit,
  target: object,
  method: string,
  action: () => Promise<unknown>,
): Promise<string> {
  const transactions = kit.module.get(TransactionPrismaService);
  const owner = target as Record<string, (...args: unknown[]) => unknown>;
  const original = owner[method];
  let observed = 'not observed';

  const spy = jest
    .spyOn(owner, method)
    .mockImplementation(async (...args: unknown[]) => {
      const [setting] = await transactions.getTransaction().$queryRaw<
        { value: string }[]
      >`SELECT current_setting('transaction_read_only') AS "value"`;
      observed = setting?.value ?? 'unknown';
      return original?.apply(target, args);
    });
  try {
    await action();
  } finally {
    spy.mockRestore();
  }
  return observed;
}
