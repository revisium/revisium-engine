import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { BackfillProjectFileBlobsCommand } from 'src/features/file-usage/commands/impl/backfill-project-file-blobs.command';
import { BackfillProjectFileBlobsResult } from 'src/features/file-usage/types';
import {
  createRowDirect,
  givenBranchWithFileTable,
  makeUploadedFileValue,
  setProjectFileBytes,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';

describe('BackfillProjectFileBlobsHandler', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function execute(args: {
    projectId: string;
    dryRun?: boolean;
  }): Promise<BackfillProjectFileBlobsResult> {
    return kit.commandBus.execute(new BackfillProjectFileBlobsCommand(args));
  }

  async function givenScenarioWithRowButNoBlobs() {
    const scenario = await givenBranchWithFileTable(kit);
    const fileValue = makeUploadedFileValue(
      `backfill-missing-${nanoid()}`,
      3333,
    );

    await createRowDirect(kit, {
      draftTableVersionId: scenario.draftTableVersionId,
      rowId: `row-${nanoid()}`,
      data: { file: fileValue, gallery: [] },
    });
    await setProjectFileBytes(kit, scenario.projectId, 0n);

    return scenario;
  }

  it('dryRun reports the planned blobs and bytes without writing', async () => {
    const scenario = await givenScenarioWithRowButNoBlobs();

    const result = await execute({
      projectId: scenario.projectId,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.blobsCreated).toBe(1);
    expect(result.fileBytesAfter).toBe(3333n);

    const active = await kit.prismaService.fileBlob.count({
      where: { projectId: scenario.projectId, deletedAt: null },
    });
    expect(active).toBe(0);
  });

  it('apply creates FileBlob rows and refreshes the counter', async () => {
    const scenario = await givenScenarioWithRowButNoBlobs();

    const result = await execute({ projectId: scenario.projectId });

    expect(result.dryRun).toBe(false);
    expect(result.blobsCreated).toBe(1);
    expect(result.fileBytesAfter).toBe(3333n);

    const usage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId: scenario.projectId },
    });
    expect(usage?.fileBytes).toBe(3333n);

    const active = await kit.prismaService.fileBlob.findMany({
      where: { projectId: scenario.projectId, deletedAt: null },
    });
    expect(active).toHaveLength(1);
  });

  it('reactivates a tombstoned FileBlob encountered during backfill', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const fileValue = makeUploadedFileValue(
      `backfill-reactivate-${nanoid()}`,
      500,
    );

    await createRowDirect(kit, {
      draftTableVersionId: scenario.draftTableVersionId,
      rowId: `row-${nanoid()}`,
      data: { file: fileValue, gallery: [] },
    });

    const tombstoned = await kit.prismaService.fileBlob.create({
      data: {
        projectId: scenario.projectId,
        hash: fileValue.hash,
        size: 500n,
        deletedAt: new Date(),
      },
    });
    await setProjectFileBytes(kit, scenario.projectId, 0n);

    const result = await execute({ projectId: scenario.projectId });

    expect(result.blobsCreated).toBe(0);

    const row = await kit.prismaService.fileBlob.findUnique({
      where: { id: tombstoned.id },
    });
    expect(row?.deletedAt).toBeNull();

    const usage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId: scenario.projectId },
    });
    expect(usage?.fileBytes).toBe(500n);
  });

  it('deduplicates same-hash references across multiple rows during backfill', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const sharedFile = makeUploadedFileValue(
      `backfill-shared-${nanoid()}`,
      777,
    );

    await createRowDirect(kit, {
      draftTableVersionId: scenario.draftTableVersionId,
      rowId: `row-a-${nanoid()}`,
      data: { file: sharedFile, gallery: [] },
    });
    await createRowDirect(kit, {
      draftTableVersionId: scenario.draftTableVersionId,
      rowId: `row-b-${nanoid()}`,
      data: { file: sharedFile, gallery: [] },
    });
    await setProjectFileBytes(kit, scenario.projectId, 0n);

    const result = await execute({ projectId: scenario.projectId });

    expect(result.blobsCreated).toBe(1);
    expect(result.referencesCreated).toBe(2);
    expect(result.fileBytesAfter).toBe(777n);

    const active = await kit.prismaService.fileBlob.findMany({
      where: { projectId: scenario.projectId, deletedAt: null },
      include: { rows: true },
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.rows).toHaveLength(2);
  });
});
