const LCG_MULTIPLIER = 1_664_525;
const LCG_INCREMENT = 1_013_904_223;
const UINT32_RANGE = 0x1_0000_0000;

export interface SeededRandom {
  pick<T>(items: readonly T[]): T;
  count(min: number, max: number): number;
}

export function seededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;

  const next = () => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state / UINT32_RANGE;
  };

  return {
    pick<T>(items: readonly T[]): T {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) {
        throw new Error('Cannot pick from an empty list');
      }

      return item;
    },

    count(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },
  };
}
