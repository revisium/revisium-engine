import {
  BENCH_PROJECT_PREFIX,
  BenchBranch,
  findBenchBranch,
  loadBranch,
  moveToProject,
  tableVersionId,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import { describeError } from 'src/features/partial-changes-poc/__bench__/support/bench-probe';
import {
  changeItems,
  createItems,
  draftItem,
  headItem,
  ITEMS,
  itemId,
  range,
  startBuilding,
} from 'src/features/partial-changes-poc/__bench__/support/data-dataset';
import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export const STOCK = 'stock';
const WRITTEN_PRICE_BASE = 1_000_000;
const WRITER_STRIDE = 100_000;

export interface TransactionAttempts {
  attempts: number;
  failures: Record<string, number>;
}

export interface WriterReport {
  writes: number;
  failures: Record<string, number>;
  lastWritten: Map<string, number>;
  written: Map<string, Set<number>>;
}

export async function ensureRaceDataset(
  kit: PartialChangesTestKit,
  rows: number,
): Promise<BenchBranch> {
  const projectId = `${BENCH_PROJECT_PREFIX}races-${rows}`;
  const existing = await findBenchBranch(kit.prisma, projectId);
  if (existing) {
    return existing;
  }

  const building = await startBuilding(kit, `races-${rows}`);
  await createItems(kit, building, rows, ITEMS);
  await createItems(kit, building, rows, STOCK);
  await kit.draftApi.apiCreateRevision(building);
  const committed = await loadBranch(kit.prisma, building.branchId);
  await changeItems(kit, committed, rows, ITEMS);
  await changeItems(kit, committed, rows, STOCK);
  return moveToProject(kit.prisma, building.branchId, projectId);
}

export function countTransactionAttempts(
  kit: PartialChangesTestKit,
): TransactionAttempts {
  const stats: TransactionAttempts = { attempts: 0, failures: {} };
  const service = kit.module.get(TransactionPrismaService) as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
  const original = service.executeTransaction;
  if (!original) {
    throw new Error('TransactionPrismaService.executeTransaction is missing');
  }
  service.executeTransaction = async function (...args: unknown[]) {
    stats.attempts += 1;
    try {
      return await original.apply(this, args);
    } catch (error) {
      const code = errorCode(error);
      stats.failures[code] = (stats.failures[code] ?? 0) + 1;
      throw error;
    }
  };
  return stats;
}

export const FENCE_KEY = 4242;
const FENCE_TRANSACTION = { timeout: 600_000, maxWait: 60_000 };

export interface WriteFence {
  enabled: boolean;
}

export function fenceNativeWrites(
  kit: PartialChangesTestKit,
  fence: WriteFence,
): void {
  const transactions = kit.module.get(TransactionPrismaService);
  const service = transactions as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
  const original = service.executeTransaction;
  if (!original) {
    throw new Error('TransactionPrismaService.executeTransaction is missing');
  }
  service.executeTransaction = function (...args: unknown[]) {
    const [handler, ...rest] = args as [
      (...handlerArgs: unknown[]) => Promise<unknown>,
      ...unknown[],
    ];
    if (!fence.enabled) {
      return original.apply(this, args);
    }
    const fenced = async (...handlerArgs: unknown[]) => {
      await transactions.getTransaction()
        .$executeRaw`SELECT pg_advisory_xact_lock_shared(${FENCE_KEY})`;
      return handler(...handlerArgs);
    };
    return original.apply(this, [fenced, ...rest]);
  };
}

export async function withExclusiveFence<T>(
  kit: PartialChangesTestKit,
  operation: () => Promise<T>,
): Promise<T> {
  let release: () => void = () => undefined;
  let acquired: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const holder = kit.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FENCE_KEY})`;
    acquired();
    await released;
  }, FENCE_TRANSACTION);

  await ready;
  try {
    return await operation();
  } finally {
    release();
    await holder;
  }
}

export function errorCode(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code) {
    return code;
  }
  return describeError(error).split(':')[0] ?? 'unknown';
}

export class PriceWriters {
  private stopped = false;
  private readonly reports: WriterReport[] = [];
  private running: Promise<void>[] = [];

  constructor(
    private readonly kits: PartialChangesTestKit[],
    private readonly branch: BenchBranch,
    private readonly rows: number,
  ) {}

  start(count: number): void {
    this.running = range(0, count).map((writer) =>
      this.run(writer, count, this.kitFor(writer)),
    );
  }

  async stop(): Promise<WriterReport> {
    this.stopped = true;
    await Promise.all(this.running);
    return mergeReports(this.reports);
  }

  private kitFor(writer: number): PartialChangesTestKit {
    const kit = this.kits[writer % this.kits.length];
    if (!kit) {
      throw new Error('No writer kit');
    }
    return kit;
  }

  private async run(
    writer: number,
    count: number,
    kit: PartialChangesTestKit,
  ): Promise<void> {
    const report: WriterReport = {
      writes: 0,
      failures: {},
      lastWritten: new Map(),
      written: new Map(),
    };
    this.reports.push(report);
    const owned = range(0, this.rows).filter(
      (index) => index % count === writer,
    );
    let sequence = 0;

    while (!this.stopped) {
      const index = owned[sequence % owned.length] ?? writer;
      const price = WRITTEN_PRICE_BASE + writer * WRITER_STRIDE + sequence;
      sequence += 1;
      const rowId = itemId(index);
      try {
        const draft = await loadBranch(kit.prisma, this.branch.branchId);
        await kit.draftApi.apiPatchRow({
          revisionId: draft.draftRevisionId,
          tableId: ITEMS,
          rowId,
          patches: [{ op: 'replace', path: 'price', value: price }],
        });
        report.writes += 1;
        report.lastWritten.set(rowId, price);
        const acknowledged = report.written.get(rowId) ?? new Set<number>();
        acknowledged.add(price);
        report.written.set(rowId, acknowledged);
      } catch (error) {
        const code = errorCode(error);
        report.failures[code] = (report.failures[code] ?? 0) + 1;
      }
    }
  }
}

function mergeReports(reports: WriterReport[]): WriterReport {
  const merged: WriterReport = {
    writes: 0,
    failures: {},
    lastWritten: new Map(),
    written: new Map(),
  };
  for (const report of reports) {
    merged.writes += report.writes;
    for (const [code, count] of Object.entries(report.failures)) {
      merged.failures[code] = (merged.failures[code] ?? 0) + count;
    }
    report.lastWritten.forEach((price, rowId) =>
      merged.lastWritten.set(rowId, price),
    );
    report.written.forEach((prices, rowId) =>
      merged.written.set(rowId, prices),
    );
  }
  return merged;
}

export async function readPrices(
  kit: PartialChangesTestKit,
  revisionId: string,
  tableId: string,
): Promise<
  Map<string, { price: number; qty: number; total: number; readonly: boolean }>
> {
  const table = await tableVersionId(kit.prisma, revisionId, tableId);
  const rows = await kit.prisma.$queryRaw<
    {
      id: string;
      price: number;
      qty: number;
      total: number;
      readonly: boolean;
    }[]
  >`
    SELECT r."id", (r."data"->>'price')::float AS "price", (r."data"->>'qty')::float AS "qty",
           (r."data"->>'total')::float AS "total", r."readonly"
    FROM "_RowToTable" rt JOIN "Row" r ON r."versionId" = rt."A"
    WHERE rt."B" = ${table}
  `;
  return new Map(rows.map(({ id, ...values }) => [id, values]));
}

export function initialPrices(index: number) {
  return { head: headItem(index).price, draft: draftItem(index).price };
}
