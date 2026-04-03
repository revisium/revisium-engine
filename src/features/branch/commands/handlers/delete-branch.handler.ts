import { BadRequestException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import {
  DeleteBranchCommand,
  DeleteBranchCommandData,
} from 'src/features/branch/commands/impl';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';

@CommandHandler(DeleteBranchCommand)
export class DeleteBranchHandler implements ICommandHandler<
  DeleteBranchCommand,
  boolean
> {
  constructor(
    private readonly transactionPrisma: TransactionPrismaService,
    private readonly shareTransactionalQueries: ShareTransactionalQueries,
  ) {}

  private get transaction() {
    return this.transactionPrisma.getTransaction();
  }

  public async execute({ data }: DeleteBranchCommand) {
    await this.transactionPrisma.runSerializable(() =>
      this.transactionHandler(data),
    );

    return true;
  }

  private async transactionHandler(data: DeleteBranchCommandData) {
    const { projectId, branchName } = data;

    const branch =
      await this.shareTransactionalQueries.findBranchInProjectOrThrow(
        projectId,
        branchName,
      );

    if (branch.isRoot) {
      throw new BadRequestException('Cannot delete the root branch');
    }

    const childBranchNames = await this.getChildBranchNames(branch.id);
    if (childBranchNames.length > 0) {
      throw new BadRequestException(
        `Cannot delete branch: it has child branches (${childBranchNames.join(', ')}). Delete them first.`,
      );
    }

    await this.deleteBranch(branch.id);
  }

  private async getChildBranchNames(branchId: string): Promise<string[]> {
    const childBranches = await this.transaction.branch.findMany({
      where: {
        revisions: {
          some: {
            isStart: true,
            parent: {
              branchId,
            },
          },
        },
      },
      select: {
        name: true,
      },
    });

    return childBranches.map((b) => b.name);
  }

  private deleteBranch(branchId: string) {
    return this.transaction.branch.delete({
      where: { id: branchId },
    });
  }
}
