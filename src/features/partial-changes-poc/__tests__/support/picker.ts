const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;
const LCG_MODULUS = 2147483648;

export class Picker {
  private state: number;
  private counter = 0;

  constructor(seed: number) {
    this.state = seed;
  }

  next(): number {
    this.state = (this.state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
    return this.state / LCG_MODULUS;
  }

  one<T>(items: readonly T[]): T | undefined {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T extends { weight: number }>(items: readonly T[]): T | undefined {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let point = this.next() * total;
    return items.find((item) => {
      point -= item.weight;
      return point < 0;
    });
  }

  name(prefix: string): string {
    this.counter += 1;
    return `${prefix}${this.counter}`;
  }
}
