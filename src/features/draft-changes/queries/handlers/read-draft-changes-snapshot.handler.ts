import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import type { TransactionPrismaClient } from 'src/features/share/types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/snapshot/fingerprint';
import {
  REVISION_ROLE_SELECT,
  RevisionRole,
  resolveRevisionRoles,
} from 'src/features/draft-changes/snapshot/revision-roles';
import { Prisma } from 'src/__generated__/client';
import {
  DraftChangesFingerprintInput,
  DRAFT_CHANGES_REVISION_INCLUDE,
  DraftChangesSnapshot,
  DraftChangesBranchSnapshot,
  DraftChangesRevisionSnapshot,
  ReadDraftChangesSnapshotQuery,
} from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';

@Injectable()
@QueryHandler(ReadDraftChangesSnapshotQuery)
export class ReadDraftChangesSnapshotHandler implements IQueryHandler<
  ReadDraftChangesSnapshotQuery,
  DraftChangesSnapshot
> {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly migrationApi: MigrationApiService,
  ) {}

  async execute(
    query: ReadDraftChangesSnapshotQuery,
  ): Promise<DraftChangesSnapshot> {
    const ambientTransaction = this.transactionService.getTransactionUnsafe();
    if (ambientTransaction) {
      await this.assertConsistentIsolation(ambientTransaction);
      return this.readSnapshot(query, ambientTransaction);
    }

    return this.transactionService.run(
      async () =>
        this.readSnapshot(query, this.transactionService.getTransaction()),
      { isolationLevel: TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async readSnapshot(
    { data }: ReadDraftChangesSnapshotQuery,
    client: TransactionPrismaClient,
  ): Promise<DraftChangesSnapshot> {
    const branch = await this.getBranch(data, client);
    const roles = await this.getRevisionRoles(branch.id, client);
    const revisionRoles = resolveRevisionRoles(roles);
    await this.migrationApi.checkRevisionLock({
      revisionId: revisionRoles.draft.id,
    });
    const revisionSnapshots = await this.getRevisionSnapshots(
      revisionRoles.head.id,
      revisionRoles.draft.id,
      client,
    );

    const fingerprintInput: DraftChangesFingerprintInput = {
      branch,
      head: revisionSnapshots.head,
      draft: revisionSnapshots.draft,
    };
    return {
      ...fingerprintInput,
      fingerprint: fingerprintDraftChangesSnapshot(fingerprintInput),
    };
  }

  private async getBranch(
    data: ReadDraftChangesSnapshotQuery['data'],
    client: TransactionPrismaClient,
  ): Promise<DraftChangesBranchSnapshot> {
    const branch = await client.branch.findUnique({
      where: {
        name_projectId: { name: data.branchName, projectId: data.projectId },
      },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }
    return branch;
  }

  private getRevisionRoles(
    branchId: string,
    client: TransactionPrismaClient,
  ): Promise<RevisionRole[]> {
    return client.revision.findMany({
      where: {
        branchId,
        OR: [{ isHead: true }, { isDraft: true }],
      },
      select: REVISION_ROLE_SELECT,
    });
  }

  private async getRevisionSnapshots(
    headRevisionId: string,
    draftRevisionId: string,
    client: TransactionPrismaClient,
  ): Promise<{
    head: DraftChangesRevisionSnapshot;
    draft: DraftChangesRevisionSnapshot;
  }> {
    const revisions = await client.revision.findMany({
      where: { id: { in: [headRevisionId, draftRevisionId] } },
      include: DRAFT_CHANGES_REVISION_INCLUDE,
    });
    const head = revisions.find(({ id }) => id === headRevisionId);
    const draft = revisions.find(({ id }) => id === draftRevisionId);
    if (!head || !draft) {
      throw new BadRequestException('Head or Draft revision is unavailable.');
    }
    return { head, draft };
  }

  private async assertConsistentIsolation(
    client: TransactionPrismaClient,
  ): Promise<void> {
    const [setting] = await client.$queryRaw<
      Array<{ transaction_isolation: string }>
    >(
      Prisma.sql`SELECT current_setting('transaction_isolation') AS transaction_isolation`,
    );
    const isolation = setting?.transaction_isolation.toLowerCase();
    if (isolation !== 'repeatable read' && isolation !== 'serializable') {
      throw new BadRequestException(
        'Draft changes snapshots require RepeatableRead or Serializable isolation.',
      );
    }
  }
}
