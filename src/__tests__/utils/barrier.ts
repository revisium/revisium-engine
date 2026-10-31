export interface Barrier {
  arrive(): Promise<void>;
  release(): void;
  expectReachedBefore(operation: Promise<unknown>): Promise<void>;
}

export function createBarrier(holder: string): Barrier {
  const arrival = createSignal();
  const departure = createSignal();

  return {
    async arrive() {
      arrival.fire();
      await departure.fired;
    },

    release: departure.fire,

    async expectReachedBefore(operation) {
      const reachedFirst = await Promise.race([
        arrival.fired.then(() => true),
        operation.then(
          () => false,
          () => false,
        ),
      ]);

      if (!reachedFirst) {
        throw new Error(`${holder} settled before reaching its barrier`);
      }
    },
  };
}

function createSignal() {
  let fire!: () => void;
  const fired = new Promise<void>((resolve) => {
    fire = resolve;
  });

  return { fired, fire };
}
