import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { RegisterFileReferencesForRowsCommand } from 'src/features/file-usage/commands/impl/register-file-references-for-rows.command';
import {
  createRowDirect,
  fakeSha256,
  givenBranchWithFileTable,
  makeUploadedFileValue,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';

describe('RegisterFileReferencesForRowsHandler', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function execute(
    data: ConstructorParameters<typeof RegisterFileReferencesForRowsCommand>[0],
  ): Promise<void> {
    return kit.commandBus.execute(
      new RegisterFileReferencesForRowsCommand(data),
    );
  }

  it('creates a new FileBlob and bumps the counter on first reference', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const fileValue = makeUploadedFileValue(`first-ref-${nanoid()}`, 1024);
    const rowId = `row-${nanoid()}`;

    const rowVersionId = await createRowDirect(kit, {
      draftTableVersionId: scenario.draftTableVersionId,
      rowId,
      data: { file: fileValue, gallery: [] },
    });

    await execute({
      revisionId: scenario.draftRevisionId,
      tableId: scenario.tableId,
      rows: [{ rowId, rowVersionId, data: { file: fileValue, gallery: [] } }],
    });

    const active = await kit.prismaService.fileBlob.findMany({
      where: { projectId: scenario.projectId, deletedAt: null },
    });
    expect(active).toHaveLength(1);

    const usage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId: scenario.projectId },
    });
    expect(usage?.fileBytes).toBe(1024n);
  });

  it('reactivates a tombstoned FileBlob and re-increments the counter', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const hash = fakeSha256(`reactivate-${nanoid()}`);
    const size = 256n;

    const tombstoned = await kit.prismaService.fileBlob.create({
      data: {
        projectId: scenario.projectId,
        hash,
        size,
        deletedAt: new Date(),
      },
    });
    await kit.prismaService.projectFileUsage.upsert({
      where: { projectId: scenario.projectId },
      create: { projectId: scenario.projectId, fileBytes: 0n },
      update: { fileBytes: 0n },
    });

    const fileValue = {
      ...makeUploadedFileValue('ignored', Number(size)),
      hash,
    };
    const rowId = `row-${nanoid()}`;
    const rowVersionId = await createRowDirect(kit, {
      draftTableVersionId: scenario.draftTableVersionId,
      rowId,
      data: { file: fileValue, gallery: [] },
    });

    await execute({
      revisionId: scenario.draftRevisionId,
      tableId: scenario.tableId,
      rows: [{ rowId, rowVersionId, data: { file: fileValue, gallery: [] } }],
    });

    const row = await kit.prismaService.fileBlob.findUnique({
      where: { id: tombstoned.id },
    });
    expect(row?.deletedAt).toBeNull();

    const usage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId: scenario.projectId },
    });
    expect(usage?.fileBytes).toBe(size);

    const all = await kit.prismaService.fileBlob.findMany({
      where: { projectId: scenario.projectId, hash },
    });
    expect(all).toHaveLength(1);
  });

  it('replaces stale blob links when an existing draft row changes to a new hash', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const firstFile = makeUploadedFileValue(`replace-old-${nanoid()}`, 100);
    const secondFile = makeUploadedFileValue(`replace-new-${nanoid()}`, 250);
    const rowId = `row-${nanoid()}`;

    const rowVersionId = await createRowDirect(kit, {
      draftTableVersionId: scenario.draftTableVersionId,
      rowId,
      data: { file: firstFile, gallery: [] },
    });

    await execute({
      revisionId: scenario.draftRevisionId,
      tableId: scenario.tableId,
      rows: [{ rowId, rowVersionId, data: { file: firstFile, gallery: [] } }],
    });

    await kit.prismaService.row.update({
      where: { versionId: rowVersionId },
      data: {
        data: { file: secondFile, gallery: [] },
      },
    });

    await execute({
      revisionId: scenario.draftRevisionId,
      tableId: scenario.tableId,
      rows: [{ rowId, rowVersionId, data: { file: secondFile, gallery: [] } }],
    });

    const active = await kit.prismaService.fileBlob.findMany({
      where: { projectId: scenario.projectId, deletedAt: null },
      orderBy: { hash: 'asc' },
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.hash).toBe(secondFile.hash);
    expect(active[0]?.size).toBe(250n);

    const tombstoned = await kit.prismaService.fileBlob.findMany({
      where: { projectId: scenario.projectId, deletedAt: { not: null } },
    });
    expect(tombstoned).toHaveLength(1);
    expect(tombstoned[0]?.hash).toBe(firstFile.hash);

    const usage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId: scenario.projectId },
    });
    expect(usage?.fileBytes).toBe(250n);
  });

  it('skips system tables', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const fileValue = makeUploadedFileValue(`system-skip-${nanoid()}`, 50);
    const rowId = `row-${nanoid()}`;

    const rowVersionId = await createRowDirect(kit, {
      draftTableVersionId: scenario.draftTableVersionId,
      rowId,
      data: { file: fileValue, gallery: [] },
    });

    await execute({
      revisionId: scenario.draftRevisionId,
      tableId: 'revisium_schema_table',
      rows: [{ rowId, rowVersionId, data: { file: fileValue, gallery: [] } }],
    });

    const blobs = await kit.prismaService.fileBlob.findMany({
      where: { projectId: scenario.projectId },
    });
    expect(blobs).toHaveLength(0);
  });

  it('is a no-op when rows is empty', async () => {
    const scenario = await givenBranchWithFileTable(kit);

    await execute({
      revisionId: scenario.draftRevisionId,
      tableId: scenario.tableId,
      rows: [],
    });

    const blobs = await kit.prismaService.fileBlob.findMany({
      where: { projectId: scenario.projectId },
    });
    expect(blobs).toHaveLength(0);
  });
});
