import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import { CommittedVersionsGuard } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';

describe('committed versions guard: accepting a known native mutation (decision 5)', () => {
  let kit: PartialChangesTestKit;
  const rewritten = new Map<string, unknown>();

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    for (const [versionId, data] of rewritten) {
      await kit.prisma.row.update({
        where: { versionId },
        data: { data: data as object },
      });
    }
    rewritten.clear();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function givenObservedCommittedRows() {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: productSchema,
        rows: { p1: product('one', 1), p2: product('two', 2) },
      },
    });
    const guard = new CommittedVersionsGuard(kit.prisma);
    guard.track(scenario.branch.branchId);
    await guard.verify();
    return {
      guard,
      known: (await scenario.headRow('products', 'p1')).versionId,
      other: (await scenario.headRow('products', 'p2')).versionId,
    };
  }

  async function rewriteInPlace(versionId: string): Promise<void> {
    const row = await kit.prisma.row.findUniqueOrThrow({
      where: { versionId },
    });
    rewritten.set(versionId, row.data);
    await kit.prisma.row.update({
      where: { versionId },
      data: { data: product('rewritten', 0) },
    });
  }

  it('accepts the known mutation of one committed row', async () => {
    const { guard, known } = await givenObservedCommittedRows();
    await rewriteInPlace(known);

    guard.acceptKnownNativeMutation([known]);

    await expect(guard.verify()).resolves.toBeUndefined();
  });

  it('still reports a mutation of any other committed row', async () => {
    const { guard, known, other } = await givenObservedCommittedRows();
    await rewriteInPlace(known);
    await rewriteInPlace(other);

    guard.acceptKnownNativeMutation([known]);

    await expect(guard.verify()).rejects.toThrow(
      `committed row version ${other} changed`,
    );
  });
});
