import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { RestoreProjectFileBytesCommand } from 'src/features/file-usage/commands/impl/restore-project-file-bytes.command';
import { RestoreProjectFileBytesResult } from 'src/features/file-usage/types';
import {
  fakeSha256,
  givenBranchWithFileTable,
  setProjectFileBytes,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';

describe('RestoreProjectFileBytesHandler', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function execute(projectId: string): Promise<RestoreProjectFileBytesResult> {
    return kit.commandBus.execute(
      new RestoreProjectFileBytesCommand({ projectId }),
    );
  }

  it('sets the counter to match SUM(FileBlob.size) and reports drift', async () => {
    const scenario = await givenBranchWithFileTable(kit);

    await kit.prismaService.fileBlob.create({
      data: {
        projectId: scenario.projectId,
        hash: fakeSha256(`restore-${nanoid()}`),
        size: 500n,
      },
    });
    await setProjectFileBytes(kit, scenario.projectId, 99999n);

    const result = await execute(scenario.projectId);

    expect(result.previousFileBytes).toBe(99999n);
    expect(result.nextFileBytes).toBe(500n);
    expect(result.drift).toBe(500n - 99999n);

    const usage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId: scenario.projectId },
    });
    expect(usage?.fileBytes).toBe(500n);
  });

  it('returns a zero-drift no-op when already correct', async () => {
    const scenario = await givenBranchWithFileTable(kit);

    await kit.prismaService.fileBlob.create({
      data: {
        projectId: scenario.projectId,
        hash: fakeSha256(`restore-nodrift-${nanoid()}`),
        size: 700n,
      },
    });
    await setProjectFileBytes(kit, scenario.projectId, 700n);

    const result = await execute(scenario.projectId);

    expect(result.previousFileBytes).toBe(700n);
    expect(result.nextFileBytes).toBe(700n);
    expect(result.drift).toBe(0n);
  });

  it('excludes tombstoned blobs when computing the expected sum', async () => {
    const scenario = await givenBranchWithFileTable(kit);

    await kit.prismaService.fileBlob.create({
      data: {
        projectId: scenario.projectId,
        hash: fakeSha256(`restore-tombstoned-${nanoid()}`),
        size: 900n,
        deletedAt: new Date(),
      },
    });
    await setProjectFileBytes(kit, scenario.projectId, 900n);

    const result = await execute(scenario.projectId);

    expect(result.nextFileBytes).toBe(0n);
    expect(result.drift).toBe(-900n);
  });
});
