import { nanoid } from 'nanoid';
import {
  getObjectSchema,
  getRefSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { FileStatus } from 'src/features/plugin/file/consts';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import { createPreviousFile } from 'src/__tests__/utils/prepareProject';
import type { createStorageMock } from 'src/__tests__/kit/storage.mock';
import { givenRowChanges } from './row-scenario';
import type { ChangesTestKit } from './test-kit';

export async function givenRemovedFile(kit: ChangesTestKit) {
  const size = 12;
  const hashLength = 64;
  const uploaded = {
    status: FileStatus.uploaded,
    fileId: nanoid(),
    url: '',
    fileName: 'original.txt',
    hash: 'a'.repeat(hashLength),
    extension: 'txt',
    mimeType: 'text/plain',
    size,
    width: 0,
    height: 0,
  };
  const f = await givenRowChanges(kit, {
    schema: getObjectSchema({
      caption: getStringSchema(),
      attachment: getRefSchema(SystemSchemaIds.File),
    }),
    head: { caption: 'base', attachment: uploaded },
    draft: { caption: 'draft', attachment: createPreviousFile() },
  });
  const blob = await kit.prismaService.fileBlob.create({
    data: {
      projectId: f.branch.projectId,
      hash: uploaded.hash,
      size: BigInt(size),
      deletedAt: new Date(),
    },
  });
  await kit.prismaService.row.update({
    where: { versionId: f.initial.headRowVersionId },
    data: { fileBlobs: { connect: { id: blob.id } } },
  });
  await kit.prismaService.projectFileUsage.create({
    data: { projectId: f.branch.projectId, fileBytes: 0n },
  });
  return {
    f,
    uploaded,
    blobId: blob.id,
    storage:
      kit.module.get<ReturnType<typeof createStorageMock>>(STORAGE_SERVICE),
    blob: () =>
      kit.prismaService.fileBlob.findUniqueOrThrow({ where: { id: blob.id } }),
    usage: () =>
      kit.prismaService.projectFileUsage.findUniqueOrThrow({
        where: { projectId: f.branch.projectId },
      }),
    async draftBlobIds() {
      const revisionId = await f.revisionId('draft');
      const row = await kit.prismaService.row.findFirstOrThrow({
        where: {
          id: f.rowId,
          tables: {
            some: { id: f.tableId, revisions: { some: { id: revisionId } } },
          },
        },
        include: { fileBlobs: true },
      });
      return row.fileBlobs.map((item) => item.id);
    },
  };
}
