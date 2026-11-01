import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import type { TransactionPrismaClient } from 'src/features/share/types';

type DatabaseCall = (...args: unknown[]) => unknown;

const RAW_CALLS = new Set([
  '$executeRaw',
  '$executeRawUnsafe',
  '$queryRaw',
  '$queryRawUnsafe',
]);

export async function countDatabaseCalls(
  kit: PartialChangesTestKit,
  write: () => Promise<unknown>,
): Promise<number> {
  let calls = 0;
  const countCall = () => {
    calls += 1;
  };

  await kit.prisma.$transaction(
    (transaction) =>
      kit.transactionService.runInTransactionContext(
        countingClient(transaction, countCall),
        write,
      ),
    { isolationLevel: TransactionIsolationLevel.Serializable },
  );

  return calls;
}

function countingClient(
  client: TransactionPrismaClient,
  countCall: () => void,
): TransactionPrismaClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);

      if (typeof property !== 'string') {
        return value;
      }

      if (RAW_CALLS.has(property)) {
        return countedCall(value as DatabaseCall, target, countCall);
      }

      if (isModelDelegate(property, value)) {
        return countingDelegate(value, countCall);
      }

      return value;
    },
  });
}

function countingDelegate(delegate: object, countCall: () => void): object {
  return new Proxy(delegate, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);

      if (typeof value !== 'function') {
        return value;
      }

      return countedCall(value as DatabaseCall, target, countCall);
    },
  });
}

function countedCall(
  call: DatabaseCall,
  owner: object,
  countCall: () => void,
): DatabaseCall {
  return (...args) => {
    countCall();

    return call.apply(owner, args);
  };
}

function isModelDelegate(property: string, value: unknown): value is object {
  return (
    !property.startsWith('$') &&
    !property.startsWith('_') &&
    typeof value === 'object' &&
    value !== null
  );
}
