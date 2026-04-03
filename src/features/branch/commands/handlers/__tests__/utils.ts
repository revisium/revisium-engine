import { CommandBus, CqrsModule } from '@nestjs/cqrs';
import { Test, TestingModule } from '@nestjs/testing';
import { AsyncLocalStorage } from 'node:async_hooks';
import { nanoid } from 'nanoid';
import { BRANCH_COMMANDS_HANDLERS } from 'src/features/branch/commands/handlers';
import { ShareModule } from 'src/features/share/share.module';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

export const createTestingModule = async () => {
  const module: TestingModule = await Test.createTestingModule({
    imports: [DatabaseModule, CqrsModule, ShareModule],
    providers: [
      {
        provide: AsyncLocalStorage,
        useValue: new AsyncLocalStorage(),
      },
      ...BRANCH_COMMANDS_HANDLERS,
    ],
  }).compile();

  await module.init();

  const prismaService = module.get(PrismaService);
  const commandBus = module.get(CommandBus);

  return {
    module,
    prismaService,
    commandBus,
  };
};

export type PrepareProjectWithBranchesReturnType = {
  projectId: string;
  rootBranchId: string;
  rootBranchName: string;
  rootHeadRevisionId: string;
  rootDraftRevisionId: string;
  childBranchId: string;
  childBranchName: string;
  childHeadRevisionId: string;
  childDraftRevisionId: string;
};

export const prepareProjectWithBranches = async (
  prismaService: PrismaService,
): Promise<PrepareProjectWithBranchesReturnType> => {
  const projectId = nanoid();

  const rootBranchId = nanoid();
  const rootBranchName = 'master';
  const rootHeadRevisionId = nanoid();
  const rootDraftRevisionId = nanoid();

  const childBranchId = nanoid();
  const childBranchName = `child-${nanoid()}`;
  const childHeadRevisionId = nanoid();
  const childDraftRevisionId = nanoid();

  const schemaTableVersionId = nanoid();
  const schemaTableCreatedId = nanoid();
  const sharedSchemasTableVersionId = nanoid();
  const sharedSchemasTableCreatedId = nanoid();
  const migrationTableVersionId = nanoid();
  const migrationTableCreatedId = nanoid();

  await prismaService.branch.create({
    data: {
      id: rootBranchId,
      name: rootBranchName,
      isRoot: true,
      projectId,
      revisions: {
        createMany: {
          data: [
            {
              id: rootHeadRevisionId,
              isHead: true,
              isStart: true,
            },
            {
              id: rootDraftRevisionId,
              parentId: rootHeadRevisionId,
              isDraft: true,
            },
          ],
        },
      },
    },
  });

  await prismaService.branch.create({
    data: {
      id: childBranchId,
      name: childBranchName,
      isRoot: false,
      projectId,
      revisions: {
        createMany: {
          data: [
            {
              id: childHeadRevisionId,
              isHead: true,
              isStart: true,
              parentId: rootHeadRevisionId,
            },
            {
              id: childDraftRevisionId,
              parentId: childHeadRevisionId,
              isDraft: true,
            },
          ],
        },
      },
    },
  });

  await prismaService.table.create({
    data: {
      id: SystemTables.Schema,
      createdId: schemaTableCreatedId,
      versionId: schemaTableVersionId,
      readonly: true,
      system: true,
      revisions: {
        connect: [
          { id: rootHeadRevisionId },
          { id: rootDraftRevisionId },
          { id: childHeadRevisionId },
          { id: childDraftRevisionId },
        ],
      },
    },
  });

  await prismaService.table.create({
    data: {
      id: SystemTables.SharedSchemas,
      createdId: sharedSchemasTableCreatedId,
      versionId: sharedSchemasTableVersionId,
      readonly: true,
      system: true,
      revisions: {
        connect: [
          { id: rootHeadRevisionId },
          { id: rootDraftRevisionId },
          { id: childHeadRevisionId },
          { id: childDraftRevisionId },
        ],
      },
    },
  });

  await prismaService.table.create({
    data: {
      id: SystemTables.Migration,
      createdId: migrationTableCreatedId,
      versionId: migrationTableVersionId,
      readonly: true,
      system: true,
      revisions: {
        connect: [
          { id: rootHeadRevisionId },
          { id: rootDraftRevisionId },
          { id: childHeadRevisionId },
          { id: childDraftRevisionId },
        ],
      },
    },
  });

  return {
    projectId,
    rootBranchId,
    rootBranchName,
    rootHeadRevisionId,
    rootDraftRevisionId,
    childBranchId,
    childBranchName,
    childHeadRevisionId,
    childDraftRevisionId,
  };
};

export const createChildBranch = async (
  prismaService: PrismaService,
  projectId: string,
  parentRevisionId: string,
  branchName: string,
): Promise<{
  branchId: string;
  headRevisionId: string;
  draftRevisionId: string;
}> => {
  const branchId = nanoid();
  const headRevisionId = nanoid();
  const draftRevisionId = nanoid();

  await prismaService.branch.create({
    data: {
      id: branchId,
      name: branchName,
      isRoot: false,
      projectId,
      revisions: {
        createMany: {
          data: [
            {
              id: headRevisionId,
              isHead: true,
              isStart: true,
              parentId: parentRevisionId,
            },
            {
              id: draftRevisionId,
              parentId: headRevisionId,
              isDraft: true,
            },
          ],
        },
      },
    },
  });

  return { branchId, headRevisionId, draftRevisionId };
};
