import { nanoid } from 'nanoid';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';
import type {
  Prisma,
  Table,
  Revision,
  Row,
  Branch,
} from 'src/__generated__/client';

export async function createBranch(
  prismaService: PrismaService,
): Promise<Branch> {
  return prismaService.branch.create({
    data: {
      id: nanoid(),
      name: nanoid(),
      projectId: nanoid(),
    },
  });
}

export async function createRevision(
  prismaService: PrismaService,
  branchId: string,
  parentId?: string,
): Promise<Revision> {
  return prismaService.revision.create({
    data: {
      id: nanoid(),
      branchId,
      ...(parentId ? { parentId } : {}),
    },
  });
}

export async function createRevisionPair(prismaService: PrismaService) {
  const branch = await createBranch(prismaService);
  const fromRevision = await createRevision(prismaService, branch.id);
  const toRevision = await createRevision(
    prismaService,
    branch.id,
    fromRevision.id,
  );

  return { branch, fromRevision, toRevision };
}

export async function createRevisionTriple(prismaService: PrismaService) {
  const branch = await createBranch(prismaService);
  const revision1 = await createRevision(prismaService, branch.id);
  const revision2 = await createRevision(
    prismaService,
    branch.id,
    revision1.id,
  );
  const revision3 = await createRevision(
    prismaService,
    branch.id,
    revision2.id,
  );

  return { branch, revision1, revision2, revision3 };
}

export async function createTableVersion({
  prismaService,
  revisionId,
  id = nanoid(),
  createdId = nanoid(),
  system = false,
  readonly = false,
}: {
  prismaService: PrismaService;
  revisionId: string;
  id?: string;
  createdId?: string;
  system?: boolean;
  readonly?: boolean;
}): Promise<Table> {
  return prismaService.table.create({
    data: {
      id,
      createdId,
      versionId: nanoid(),
      system,
      readonly,
      revisions: {
        connect: { id: revisionId },
      },
    },
  });
}

export async function createRowVersion({
  prismaService,
  tableVersionId,
  id = nanoid(),
  createdId = nanoid(),
  publishedAt,
  data = { name: 'test' },
  hash = nanoid(),
  schemaHash = nanoid(),
}: {
  prismaService: PrismaService;
  tableVersionId: string;
  id?: string;
  createdId?: string;
  publishedAt?: Date;
  data?: Prisma.InputJsonValue;
  hash?: string;
  schemaHash?: string;
}): Promise<Row> {
  return prismaService.row.create({
    data: {
      id,
      createdId,
      versionId: nanoid(),
      ...(publishedAt ? { publishedAt } : {}),
      tables: {
        connect: { versionId: tableVersionId },
      },
      data,
      hash,
      schemaHash,
    },
  });
}
