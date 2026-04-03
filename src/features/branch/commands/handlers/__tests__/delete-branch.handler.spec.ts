import { BadRequestException } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import {
  createChildBranch,
  createTestingModule,
  prepareProjectWithBranches,
} from 'src/features/branch/commands/handlers/__tests__/utils';
import { DeleteBranchCommand } from 'src/features/branch/commands/impl';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

describe('DeleteBranchHandler', () => {
  it('should delete non-root branch', async () => {
    const { projectId, childBranchId, childBranchName } =
      await prepareProjectWithBranches(prismaService);

    const command = new DeleteBranchCommand({
      projectId,
      branchName: childBranchName,
    });

    const result = await execute(command);

    expect(result).toBe(true);

    const branch = await prismaService.branch.findUnique({
      where: { id: childBranchId },
    });
    expect(branch).toBeNull();
  });

  it('should fail to delete root branch', async () => {
    const { projectId, rootBranchName } =
      await prepareProjectWithBranches(prismaService);

    const command = new DeleteBranchCommand({
      projectId,
      branchName: rootBranchName,
    });

    const promise = execute(command);

    await expect(promise).rejects.toThrow(BadRequestException);
    await expect(promise).rejects.toThrow('Cannot delete the root branch');
  });

  it('should not affect other branches', async () => {
    const { projectId, rootBranchId, childBranchName } =
      await prepareProjectWithBranches(prismaService);

    const command = new DeleteBranchCommand({
      projectId,
      branchName: childBranchName,
    });

    await execute(command);

    const rootBranch = await prismaService.branch.findUnique({
      where: { id: rootBranchId },
    });
    expect(rootBranch).not.toBeNull();
  });

  it('should cascade delete revisions', async () => {
    const {
      projectId,
      childBranchName,
      childHeadRevisionId,
      childDraftRevisionId,
    } = await prepareProjectWithBranches(prismaService);

    const command = new DeleteBranchCommand({
      projectId,
      branchName: childBranchName,
    });

    await execute(command);

    const headRevision = await prismaService.revision.findUnique({
      where: { id: childHeadRevisionId },
    });
    expect(headRevision).toBeNull();

    const draftRevision = await prismaService.revision.findUnique({
      where: { id: childDraftRevisionId },
    });
    expect(draftRevision).toBeNull();
  });

  it('should fail to delete branch with one child branch', async () => {
    const { projectId, childBranchName, childHeadRevisionId } =
      await prepareProjectWithBranches(prismaService);

    const grandchildBranchName = 'grandchild-branch';
    await createChildBranch(
      prismaService,
      projectId,
      childHeadRevisionId,
      grandchildBranchName,
    );

    const command = new DeleteBranchCommand({
      projectId,
      branchName: childBranchName,
    });

    const promise = execute(command);

    await expect(promise).rejects.toThrow(BadRequestException);
    await expect(promise).rejects.toThrow(
      `Cannot delete branch: it has child branches (${grandchildBranchName}). Delete them first.`,
    );
  });

  it('should fail to delete branch with multiple child branches', async () => {
    const { projectId, childBranchName, childHeadRevisionId } =
      await prepareProjectWithBranches(prismaService);

    const grandchild1 = 'grandchild-1';
    const grandchild2 = 'grandchild-2';
    await createChildBranch(
      prismaService,
      projectId,
      childHeadRevisionId,
      grandchild1,
    );
    await createChildBranch(
      prismaService,
      projectId,
      childHeadRevisionId,
      grandchild2,
    );

    const command = new DeleteBranchCommand({
      projectId,
      branchName: childBranchName,
    });

    const promise = execute(command);

    await expect(promise).rejects.toThrow(BadRequestException);
    await expect(promise).rejects.toThrow(
      'Cannot delete branch: it has child branches',
    );
    await expect(promise).rejects.toThrow(grandchild1);
    await expect(promise).rejects.toThrow(grandchild2);
  });

  let prismaService: PrismaService;
  let commandBus: CommandBus;

  function execute(command: DeleteBranchCommand): Promise<boolean> {
    return commandBus.execute(command);
  }

  beforeAll(async () => {
    const result = await createTestingModule();
    prismaService = result.prismaService;
    commandBus = result.commandBus;
  });

  afterAll(async () => {
    await prismaService.$disconnect();
  });
});
