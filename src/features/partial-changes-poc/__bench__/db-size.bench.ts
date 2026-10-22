import { BENCH_PROJECT_PREFIX } from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import {
  emitResult,
  readDatabaseSize,
} from 'src/features/partial-changes-poc/__bench__/support/bench-probe';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';

describe('database size', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('reports the database size and the benchmark projects', async () => {
    emitResult({
      kind: 'size',
      ...(await readDatabaseSize(kit.prisma)),
      benchBranches: await kit.prisma.branch.count({
        where: { projectId: { startsWith: BENCH_PROJECT_PREFIX } },
      }),
    });
  });
});
