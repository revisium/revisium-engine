import {
  BENCH_PROJECT_PREFIX,
  dropProjects,
  sweepOrphans,
  vacuumFull,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import {
  emitResult,
  readDatabaseSize,
} from 'src/features/partial-changes-poc/__bench__/support/bench-probe';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';

describe('benchmark data cleanup', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('drops every benchmark project, sweeps unreachable versions and compacts the tables', async () => {
    const before = await readDatabaseSize(kit.prisma);
    await dropProjects(kit.prisma, `${BENCH_PROJECT_PREFIX}%`);
    const orphans = await sweepOrphans(kit.prisma);
    await vacuumFull(kit.prisma);
    const after = await readDatabaseSize(kit.prisma);

    emitResult({ kind: 'cleanup', before, orphans, after });
    expect(
      await kit.prisma.branch.count({
        where: { projectId: { startsWith: BENCH_PROJECT_PREFIX } },
      }),
    ).toBe(0);
  });
});
