import { Prisma } from 'src/__generated__/client';
import {
  DraftRevisionStateRow,
  DraftRevisionStateTable,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';

export function toRowCreateInput(
  candidate: DraftRevisionStateRow,
  versionId: string,
): Prisma.RowCreateInput {
  return {
    versionId,
    createdId: candidate.createdId,
    id: candidate.id,
    readonly: false,
    createdAt: candidate.createdAt,
    publishedAt: candidate.publishedAt,
    data:
      candidate.data === null
        ? Prisma.JsonNull
        : (candidate.data as Prisma.InputJsonValue),
    meta:
      candidate.meta === null
        ? Prisma.JsonNull
        : (candidate.meta as Prisma.InputJsonValue),
    hash: candidate.hash,
    schemaHash: candidate.schemaHash,
    fileBlobs: { connect: candidate.fileBlobs.map(({ id }) => ({ id })) },
  };
}

export function toTableCreateInput(
  candidate: DraftRevisionStateTable,
  versionId: string,
): Prisma.TableCreateInput {
  return {
    versionId,
    createdId: candidate.createdId,
    id: candidate.id,
    readonly: false,
    createdAt: candidate.createdAt,
    system: candidate.system,
  };
}
