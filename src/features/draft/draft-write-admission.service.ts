import { Injectable } from '@nestjs/common';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { BranchWriteFenceService } from 'src/infrastructure/database/branch-write-fence.service';
import type { AttemptObserver } from 'src/infrastructure/database/operation-transaction-runner';
import { EscalatingTransactionRunner } from 'src/infrastructure/database/escalating-transaction-runner';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
export class DraftWriteAdmissionService {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly branchWriteFence: BranchWriteFenceService,
    private readonly migrationLockService: MigrationLockService,
    private readonly escalatingTransactionRunner: EscalatingTransactionRunner,
  ) {}

  // The observer hears each transaction attempt as it starts, before admission, so a refused attempt is counted too.
  runSerializableRevisionWrite<T>(
    revisionId: string,
    write: () => Promise<T>,
    observer?: AttemptObserver,
  ): Promise<T> {
    return this.transactionService.runSerializable(async () => {
      observer?.attempted(false);
      await this.admitRevisionWrite(revisionId);

      return write();
    });
  }

  runSerializableCommit<T>(
    projectId: string,
    branchName: string,
    commit: () => Promise<T>,
  ): Promise<T> {
    return this.escalatingTransactionRunner.runSerializable(
      { projectId, branchName },
      async () => {
        await this.admitBranchWrite(projectId, branchName);

        return commit();
      },
    );
  }

  runSerializableRevert<T>(
    projectId: string,
    branchName: string,
    revert: () => Promise<T>,
  ): Promise<T> {
    return this.escalatingTransactionRunner.runSerializable(
      { projectId, branchName },
      async () => {
        await this.enterBranchFence(projectId, branchName);

        return revert();
      },
    );
  }

  async admitBranchWrite(projectId: string, branchName: string): Promise<void> {
    const draftRevisionId = await this.findDraftRevisionId(
      projectId,
      branchName,
    );

    if (draftRevisionId) {
      await this.admitRevisionWrite(draftRevisionId);
    }
  }

  private async enterBranchFence(
    projectId: string,
    branchName: string,
  ): Promise<void> {
    const draftRevisionId = await this.findDraftRevisionId(
      projectId,
      branchName,
    );

    if (draftRevisionId) {
      await this.branchWriteFence.enterSharedForRevision(draftRevisionId);
    }
  }

  private async admitRevisionWrite(revisionId: string): Promise<void> {
    await this.branchWriteFence.enterSharedForRevision(revisionId);
    await this.migrationLockService.checkRevisionLock(revisionId);
  }

  private async findDraftRevisionId(
    projectId: string,
    branchName: string,
  ): Promise<string | undefined> {
    const draftRevision = await this.transactionService
      .getTransaction()
      .revision.findFirst({
        where: { isDraft: true, branch: { projectId, name: branchName } },
        select: { id: true },
      });

    return draftRevision?.id;
  }
}
