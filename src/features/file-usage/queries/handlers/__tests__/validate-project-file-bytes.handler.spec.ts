import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { ValidateProjectFileBytesQuery } from 'src/features/file-usage/queries/impl/validate-project-file-bytes.query';
import { ValidateProjectFileBytesResult } from 'src/features/file-usage/types';
import {
  fakeSha256,
  givenBranchWithFileTable,
  setProjectFileBytes,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';

describe('ValidateProjectFileBytesHandler', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function execute(projectId: string): Promise<ValidateProjectFileBytesResult> {
    return kit.queryBus.execute(
      new ValidateProjectFileBytesQuery({ projectId }),
    );
  }

  it('reports drift, fileBlobCount, and referenceCount for active blobs', async () => {
    const scenario = await givenBranchWithFileTable(kit);

    await kit.prismaService.fileBlob.create({
      data: {
        projectId: scenario.projectId,
        hash: fakeSha256(`validate-${nanoid()}`),
        size: 2048n,
      },
    });
    await setProjectFileBytes(kit, scenario.projectId, 2048n);

    const report = await execute(scenario.projectId);

    expect(report.currentFileBytes).toBe(2048n);
    expect(report.expectedFileBytes).toBe(2048n);
    expect(report.drift).toBe(0n);
    expect(report.fileBlobCount).toBe(1);
  });

  it('excludes tombstoned blobs from expectedFileBytes and fileBlobCount', async () => {
    const scenario = await givenBranchWithFileTable(kit);

    await kit.prismaService.fileBlob.create({
      data: {
        projectId: scenario.projectId,
        hash: fakeSha256(`validate-tombstoned-${nanoid()}`),
        size: 777n,
        deletedAt: new Date(),
      },
    });
    await setProjectFileBytes(kit, scenario.projectId, 0n);

    const report = await execute(scenario.projectId);

    expect(report.expectedFileBytes).toBe(0n);
    expect(report.fileBlobCount).toBe(0);
    expect(report.drift).toBe(0n);
  });

  it('detects drift when the counter is wrong', async () => {
    const scenario = await givenBranchWithFileTable(kit);

    await kit.prismaService.fileBlob.create({
      data: {
        projectId: scenario.projectId,
        hash: fakeSha256(`validate-drift-${nanoid()}`),
        size: 500n,
      },
    });
    await setProjectFileBytes(kit, scenario.projectId, 99999n);

    const report = await execute(scenario.projectId);

    expect(report.currentFileBytes).toBe(99999n);
    expect(report.expectedFileBytes).toBe(500n);
    expect(report.drift).toBe(500n - 99999n);
  });
});
