import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { RegisterFileReferencesForRowVersionsCommand } from 'src/features/file-usage/commands/impl/register-file-references-for-row-versions.command';
import {
  createRowDirect,
  givenBranchWithFileTable,
  makeUploadedFileValue,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';

describe('RegisterFileReferencesForRowVersionsHandler', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function execute(
    data: ConstructorParameters<
      typeof RegisterFileReferencesForRowVersionsCommand
    >[0],
  ): Promise<void> {
    return kit.commandBus.execute(
      new RegisterFileReferencesForRowVersionsCommand(data),
    );
  }

  it('loads row data by versionId and registers the references', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const fileValue = makeUploadedFileValue(`rowver-${nanoid()}`, 2048);

    const rowVersionId = await createRowDirect(kit, {
      draftTableVersionId: scenario.draftTableVersionId,
      rowId: `row-${nanoid()}`,
      data: { file: fileValue, gallery: [] },
    });

    await execute({
      revisionId: scenario.draftRevisionId,
      tableId: scenario.tableId,
      rowVersionIds: [rowVersionId],
    });

    const blobs = await kit.prismaService.fileBlob.findMany({
      where: { projectId: scenario.projectId, deletedAt: null },
    });
    expect(blobs).toHaveLength(1);

    const usage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId: scenario.projectId },
    });
    expect(usage?.fileBytes).toBe(2048n);
  });

  it('is a no-op when rowVersionIds is empty', async () => {
    const scenario = await givenBranchWithFileTable(kit);

    await execute({
      revisionId: scenario.draftRevisionId,
      tableId: scenario.tableId,
      rowVersionIds: [],
    });

    const blobs = await kit.prismaService.fileBlob.findMany({
      where: { projectId: scenario.projectId },
    });
    expect(blobs).toHaveLength(0);
  });

  it('does nothing when none of the supplied versionIds exist', async () => {
    const scenario = await givenBranchWithFileTable(kit);

    await execute({
      revisionId: scenario.draftRevisionId,
      tableId: scenario.tableId,
      rowVersionIds: [`missing-${nanoid()}`],
    });

    const blobs = await kit.prismaService.fileBlob.findMany({
      where: { projectId: scenario.projectId },
    });
    expect(blobs).toHaveLength(0);
  });
});
