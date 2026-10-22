import {
  dropProjects,
  exactProject,
  loadBranch,
} from 'src/features/partial-changes-poc/__bench__/support/bench-branches';
import {
  describeError,
  emitResult,
} from 'src/features/partial-changes-poc/__bench__/support/bench-probe';
import {
  createItems,
  draftItem,
  ITEMS,
  itemId,
  patchesOf,
  startBuilding,
  timed,
} from 'src/features/partial-changes-poc/__bench__/support/data-dataset';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';

const SIZES = (process.env.BENCH_LIMIT_SIZES ?? '32700,32800,65500,65600')
  .split(',')
  .map(Number);

describe('native limits', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(SIZES)(
    'first native write to a committed table of %d rows',
    async (rows) => {
      const building = await startBuilding(kit, `limits-${rows}`);
      await createItems(kit, building, rows);
      await kit.draftApi.apiCreateRevision(building);
      const committed = await loadBranch(kit.prisma, building.branchId);

      let error: string | undefined;
      const ms = await timed(async () => {
        try {
          await kit.draftApi.apiPatchRow({
            revisionId: committed.draftRevisionId,
            tableId: ITEMS,
            rowId: itemId(1),
            patches: patchesOf(draftItem(1)),
          });
        } catch (caught) {
          error = describeError(caught);
        }
      });

      emitResult({
        kind: 'native-limit',
        operation: 'apiPatchRow on a committed table (copy-on-write)',
        rows,
        ok: error === undefined,
        ms,
        error,
      });
      await dropProjects(kit.prisma, exactProject(committed.projectId));
    },
  );
});
