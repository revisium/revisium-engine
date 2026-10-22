export class Barrier {
  private readonly reached: Promise<void>;
  private readonly released: Promise<void>;
  private markReached: () => void = () => undefined;
  private markReleased: () => void = () => undefined;

  constructor() {
    this.reached = new Promise((resolve) => {
      this.markReached = resolve;
    });
    this.released = new Promise((resolve) => {
      this.markReleased = resolve;
    });
  }

  async arriveAndWait(): Promise<void> {
    this.markReached();
    await this.released;
  }

  whenReached(): Promise<void> {
    return this.reached;
  }

  release(): void {
    this.markReleased();
  }
}

export function pauseOnce<T extends object, K extends keyof T>(
  target: T,
  method: K,
  barrier: Barrier,
): jest.SpyInstance {
  const original = target[method] as unknown as (
    ...args: unknown[]
  ) => Promise<unknown>;
  let paused = false;

  return jest.spyOn(target, method as never).mockImplementation((async (
    ...args: unknown[]
  ) => {
    if (!paused) {
      paused = true;
      await barrier.arriveAndWait();
    }
    return original.apply(target, args);
  }) as never);
}
