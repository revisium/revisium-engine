import type { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export async function raceTransactions<T>(
  service: TransactionPrismaService,
  actions: Array<() => Promise<T>>,
) {
  const original = service.runSerializable.bind(service);
  let arrivals = 0;
  let release: () => void = () => {
    throw new Error('Barrier has not been initialized.');
  };
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  function synchronized<R>(
    handler: (...args: unknown[]) => Promise<R>,
    options?: Parameters<typeof service.runSerializable>[1],
  ): Promise<R> {
    let arrived = false;
    return original(async (...args) => {
      if (!arrived) {
        arrived = true;
        arrivals += 1;
        if (arrivals === actions.length) {
          release();
        }
        await barrier;
      }
      return handler(...args);
    }, options);
  }
  const hook = jest
    .spyOn(service, 'runSerializable')
    .mockImplementation(synchronized);
  try {
    return await Promise.all(actions.map((action) => action()));
  } finally {
    release();
    hook.mockRestore();
  }
}
