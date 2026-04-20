import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { GetProjectStorageBytesQuery } from 'src/features/file-usage/queries/impl/get-project-storage-bytes.query';
import {
  givenBranchWithFileTable,
  setProjectFileBytes,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';

describe('GetProjectStorageBytesHandler', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function execute(projectId: string): Promise<bigint> {
    return kit.queryBus.execute(new GetProjectStorageBytesQuery({ projectId }));
  }

  it('returns the project counter when it exists', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    await setProjectFileBytes(kit, scenario.projectId, 4096n);

    const value = await execute(scenario.projectId);

    expect(value).toBe(4096n);
  });

  it('returns zero when no ProjectFileUsage row exists', async () => {
    const missing = `missing-${nanoid()}`;

    const value = await execute(missing);

    expect(value).toBe(0n);
  });
});
