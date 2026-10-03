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
import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/draft-changes.fingerprint';
import { Prisma } from 'src/__generated__/client';
import {
  DraftChangesFingerprintInput,
  DRAFT_CHANGES_REVISION_INCLUDE,
  DraftChangesSnapshot,
  DraftChangesBranchSnapshot,
  DraftChangesRevisionSnapshot,
  ReadDraftChangesSnapshotQuery,
} from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';

const REVISION_ROLE_SELECT = {
  id: true,
  isHead: true,
  isDraft: true,
  parentId: true,
} satisfies Prisma.RevisionSelect;

type RevisionRole = Prisma.RevisionGetPayload<{
  select: typeof REVISION_ROLE_SELECT;
}>;

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
    const [headRole, draftRole] = this.validateRevisionRoles(roles);
    await this.migrationApi.checkRevisionLock({ revisionId: draftRole.id });
    const { head, draft } = await this.getRevisionSnapshots(
      headRole.id,
      draftRole.id,
      client,
    );

    const fingerprintInput: DraftChangesFingerprintInput = {
      branch,
      head,
      draft,
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

  private validateRevisionRoles(
    roleRevisions: RevisionRole[],
  ): [RevisionRole, RevisionRole] {
    const heads = roleRevisions.filter(({ isHead }) => isHead);
    const drafts = roleRevisions.filter(({ isDraft }) => isDraft);
    const headRole = heads[0];
    const draftRole = drafts[0];
    if (heads.length !== 1 || drafts.length !== 1 || !headRole || !draftRole) {
      throw new BadRequestException(
        'Branch must have exactly one Head and one Draft revision.',
      );
    }
    if (headRole.id === draftRole.id) {
      throw new BadRequestException(
        'Head and Draft must be distinct revisions.',
      );
    }
    if (draftRole.parentId !== headRole.id) {
      throw new BadRequestException(
        'Draft must have its branch Head as its parent.',
      );
    }
    return [headRole, draftRole];
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
