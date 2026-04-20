import { nanoid } from 'nanoid';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  getArraySchema,
  getObjectSchema,
  getRefSchema,
} from '@revisium/schema-toolkit/mocks';
import { FileStatus, ID_LENGTH } from 'src/features/plugin/file/consts';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  prepareBranch,
  prepareTableWithSchema,
} from 'src/__tests__/utils/prepareProject';

const HASH_LENGTH = 64;
const HASH_CHARS = '0123456789abcdef';
const HEX_NORMALIZER = /[^0-9a-f]/gi;

export function fakeSha256(seed: string): string {
  const normalized = seed.replace(HEX_NORMALIZER, '').toLowerCase();
  if (normalized.length >= HASH_LENGTH) {
    return normalized.slice(0, HASH_LENGTH);
  }

  let result = normalized;
  while (result.length < HASH_LENGTH) {
    result += HASH_CHARS[result.length % HASH_CHARS.length];
  }
  return result;
}

export function makeUploadedFileValue(hashSeed: string, size: number) {
  return {
    status: FileStatus.uploaded,
    fileId: nanoid(ID_LENGTH),
    url: '',
    fileName: `${hashSeed}.bin`,
    hash: fakeSha256(hashSeed),
    extension: 'bin',
    mimeType: 'application/octet-stream',
    size,
    width: 0,
    height: 0,
  };
}

export async function givenBranchWithFileTable(kit: DraftTestKit) {
  const branch = await prepareBranch(kit.prismaService);

  const schema = getObjectSchema({
    file: getRefSchema(SystemSchemaIds.File),
    gallery: getArraySchema(getRefSchema(SystemSchemaIds.File)),
  });

  const table = await prepareTableWithSchema({
    prismaService: kit.prismaService,
    headRevisionId: branch.headRevisionId,
    draftRevisionId: branch.draftRevisionId,
    schemaTableVersionId: branch.schemaTableVersionId,
    migrationTableVersionId: branch.migrationTableVersionId,
    schema,
  });

  return {
    projectId: branch.projectId,
    draftRevisionId: branch.draftRevisionId,
    headRevisionId: branch.headRevisionId,
    tableId: table.tableId,
    draftTableVersionId: table.draftTableVersionId,
  };
}

export async function createRowDirect(
  kit: DraftTestKit,
  args: {
    draftTableVersionId: string;
    rowId: string;
    data: object;
  },
): Promise<string> {
  const versionId = nanoid();
  const createdId = nanoid();

  await kit.prismaService.row.create({
    data: {
      versionId,
      createdId,
      id: args.rowId,
      readonly: false,
      data: args.data as object,
      hash: fakeSha256(`row-${args.rowId}`),
      schemaHash: '',
      tables: {
        connect: { versionId: args.draftTableVersionId },
      },
    },
  });

  return versionId;
}

export async function setProjectFileBytes(
  kit: DraftTestKit,
  projectId: string,
  value: bigint,
): Promise<void> {
  await kit.prismaService.projectFileUsage.upsert({
    where: { projectId },
    create: { projectId, fileBytes: value },
    update: { fileBytes: value },
  });
}
