import { dropProjects } from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import {
  emitResult,
  readDatabaseSize,
} from 'src/features/partial-changes-poc/__bench__/support/bench-probe';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';

const pattern = process.env.BENCH_DROP_PATTERN ?? '';

describe('benchmark data drop by pattern', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('drops the matching benchmark projects', async () => {
    if (!pattern.startsWith('bench-')) {
      throw new Error('BENCH_DROP_PATTERN must start with bench-');
    }
    const before = await readDatabaseSize(kit.prisma);
    await dropProjects(kit.prisma, pattern);
    await kit.prisma.$executeRawUnsafe('VACUUM ANALYZE "Row", "_RowToTable"');
    emitResult({
      kind: 'drop',
      pattern,
      before,
      after: await readDatabaseSize(kit.prisma),
    });
  });
});
