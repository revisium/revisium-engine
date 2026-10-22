import { performance } from 'node:perf_hooks';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

const KB = 1024;
const MB = KB * KB;
const ERROR_TAIL_LINES = 3;
const SAMPLE_INTERVAL_MS = 20;

export interface PhaseTotal {
  ms: number;
  calls: number;
}

export interface DatabaseSize {
  databaseMb: number;
  rows: number;
  rowLinks: number;
}

export interface Measurement<T> {
  value?: T;
  error?: string;
  wallMs: number;
  inTransactionMs: number;
  attempts: number;
  rssBeforeMb: number;
  rssPeakMb: number;
  processMaxRssMb: number;
  heapPeakMb: number;
  dbBefore: DatabaseSize;
  dbAfter: DatabaseSize;
  phases: Record<string, PhaseTotal>;
}

type AnyMethod = (...args: unknown[]) => unknown;

export class BenchProbe {
  private readonly phases = new Map<string, PhaseTotal>();
  private readonly transactionPhases = new Set<string>();
  private peakRss = 0;
  private peakHeap = 0;

  constructor(private readonly prisma: PrismaService) {}

  instrument(
    target: object,
    methods: readonly string[],
    prefix: string,
    options: { transaction?: boolean; sampleMemory?: boolean } = {},
  ): void {
    const record = (name: string, ms: number) => this.record(name, ms);
    const sample = () => this.sampleMemory();
    const owner = target as Record<string, unknown>;
    const sampleMemory = options.sampleMemory ?? true;

    for (const method of methods) {
      const original = owner[method] as AnyMethod | undefined;
      if (typeof original !== 'function') {
        throw new Error(`${prefix}.${method} is not a method`);
      }
      const name = `${prefix}.${method}`;
      if (options.transaction) {
        this.transactionPhases.add(name);
      }

      owner[method] = function (this: unknown, ...args: unknown[]) {
        if (sampleMemory) {
          sample();
        }
        const started = performance.now();
        const finish = () => {
          record(name, performance.now() - started);
          if (sampleMemory) {
            sample();
          }
        };

        let result: unknown;
        try {
          result = original.apply(this, args);
        } catch (error) {
          finish();
          throw error;
        }
        if (result instanceof Promise) {
          return result.finally(finish);
        }
        finish();
        return result;
      };
    }
  }

  async measure<T>(operation: () => Promise<T>): Promise<Measurement<T>> {
    this.phases.clear();
    collectGarbage();
    const dbBefore = await readDatabaseSize(this.prisma);
    const rssBefore = process.memoryUsage.rss();
    this.peakRss = rssBefore;
    this.peakHeap = process.memoryUsage().heapUsed;
    const sampler = setInterval(() => this.sampleMemory(), SAMPLE_INTERVAL_MS);

    const started = performance.now();
    let value: T | undefined;
    let error: string | undefined;
    try {
      value = await operation();
    } catch (caught) {
      error = describeError(caught);
    }
    const wallMs = performance.now() - started;
    clearInterval(sampler);
    this.sampleMemory();

    const phases = Object.fromEntries(
      [...this.phases].map(([name, total]) => [name, roundPhase(total)]),
    );
    const transaction = [...this.transactionPhases]
      .map((name) => this.phases.get(name))
      .filter((total): total is PhaseTotal => total !== undefined);

    return {
      value,
      error,
      wallMs: round(wallMs),
      inTransactionMs: round(sum(transaction.map((total) => total.ms))),
      attempts: sum(transaction.map((total) => total.calls)),
      rssBeforeMb: toMb(rssBefore),
      rssPeakMb: toMb(this.peakRss),
      processMaxRssMb: toMb(process.resourceUsage().maxRSS * KB),
      heapPeakMb: toMb(this.peakHeap),
      dbBefore,
      dbAfter: await readDatabaseSize(this.prisma),
      phases,
    };
  }

  private record(name: string, ms: number): void {
    const total = this.phases.get(name) ?? { ms: 0, calls: 0 };
    total.ms += ms;
    total.calls += 1;
    this.phases.set(name, total);
  }

  private sampleMemory(): void {
    const rss = process.memoryUsage.rss();
    if (rss > this.peakRss) {
      this.peakRss = rss;
    }
    const { heapUsed } = process.memoryUsage();
    if (heapUsed > this.peakHeap) {
      this.peakHeap = heapUsed;
    }
  }
}

export async function readDatabaseSize(
  prisma: PrismaService,
): Promise<DatabaseSize> {
  const [size] = await prisma.$queryRaw<
    { database: bigint; rows: number; rowLinks: number }[]
  >`
    SELECT pg_database_size(current_database()) AS "database",
           (SELECT count(*)::int FROM "Row") AS "rows",
           (SELECT count(*)::int FROM "_RowToTable") AS "rowLinks"
  `;
  return {
    databaseMb: toMb(Number(size?.database ?? 0)),
    rows: size?.rows ?? 0,
    rowLinks: size?.rowLinks ?? 0,
  };
}

export function emitResult(record: Record<string, unknown>): void {
  process.stdout.write(`BENCH_RESULT ${JSON.stringify(record)}\n`);
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    const kind = code
      ? `${error.constructor.name}(${code})`
      : error.constructor.name;
    const message = error.message
      .split('\n')
      .slice(-ERROR_TAIL_LINES)
      .join(' ');
    return `${kind}: ${message}`;
  }
  return String(error);
}

function collectGarbage(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
}

function toMb(bytes: number): number {
  return Math.round(bytes / MB);
}

function round(value: number): number {
  return Math.round(value);
}

function roundPhase(total: PhaseTotal): PhaseTotal {
  return { ms: round(total.ms), calls: total.calls };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
