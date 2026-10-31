import { Injectable } from '@nestjs/common';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { BranchWriteFenceService } from 'src/infrastructure/database/branch-write-fence.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
export class DraftWriteAdmissionService {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly branchWriteFence: BranchWriteFenceService,
    private readonly migrationLockService: MigrationLockService,
  ) {}

  runSerializableRevisionWrite<T>(
    revisionId: string,
    write: () => Promise<T>,
  ): Promise<T> {
    return this.transactionService.runSerializable(async () => {
      await this.admitRevisionWrite(revisionId);

      return write();
    });
  }

  runSerializableBranchWrite<T>(
    projectId: string,
    branchName: string,
    write: () => Promise<T>,
  ): Promise<T> {
    return this.transactionService.runSerializable(async () => {
      await this.admitBranchWrite(projectId, branchName);

      return write();
    });
  }

  private async admitBranchWrite(
    projectId: string,
    branchName: string,
  ): Promise<void> {
    const draftRevisionId = await this.findDraftRevisionId(
      projectId,
      branchName,
    );

    if (draftRevisionId) {
      await this.admitRevisionWrite(draftRevisionId);
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
