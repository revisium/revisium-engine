import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { GetStorageBytesForProjectsQuery } from 'src/features/file-usage/queries/impl/get-storage-bytes-for-projects.query';
import {
  givenBranchWithFileTable,
  setProjectFileBytes,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';

describe('GetStorageBytesForProjectsHandler', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function execute(projectIds: readonly string[]): Promise<bigint> {
    return kit.queryBus.execute(
      new GetStorageBytesForProjectsQuery({ projectIds }),
    );
  }

  it('sums the counters for the supplied projectIds', async () => {
    const first = await givenBranchWithFileTable(kit);
    const second = await givenBranchWithFileTable(kit);

    await setProjectFileBytes(kit, first.projectId, 100n);
    await setProjectFileBytes(kit, second.projectId, 200n);

    const total = await execute([first.projectId, second.projectId]);

    expect(total).toBe(300n);
  });

  it('ignores unknown projectIds', async () => {
    const first = await givenBranchWithFileTable(kit);
    await setProjectFileBytes(kit, first.projectId, 50n);

    const total = await execute([first.projectId, `missing-${nanoid()}`]);

    expect(total).toBe(50n);
  });

  it('returns zero when the list is empty', async () => {
    const total = await execute([]);

    expect(total).toBe(0n);
  });
});
