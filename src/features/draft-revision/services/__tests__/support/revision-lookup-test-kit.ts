import { Prisma } from 'src/__generated__/client';
import { BranchApiService } from 'src/features/branch/branch-api.service';
import {
  createDraftRevisionTestingModule,
  prepareDraftRevisionTest,
} from 'src/features/draft-revision/commands/handlers/__tests__/utils';
import { DraftRevisionInternalService } from 'src/features/draft-revision/services/draft-revision-internal.service';
import { RevisionsApiService } from 'src/features/revision/revisions-api.service';

export interface BranchRevisionLookup {
  name: string;
  read: 'getHeadRevision' | 'getDraftRevision';
  missingRecord: Prisma.RevisionUpdateManyMutationInput;
  notFoundMessage: string;
  find(
    internal: DraftRevisionInternalService,
    branchId: string,
  ): Promise<unknown>;
}

export const headRevisionLookup: BranchRevisionLookup = {
  name: 'Head revision',
  read: 'getHeadRevision',
  missingRecord: { isHead: false },
  notFoundMessage: 'Head revision not found',
  find: (internal, branchId) => internal.findHeadRevisionOrThrow(branchId),
};

export const draftRevisionLookup: BranchRevisionLookup = {
  name: 'Draft revision',
  read: 'getDraftRevision',
  missingRecord: { isDraft: false },
  notFoundMessage: 'Draft revision not found',
  find: (internal, branchId) => internal.findDraftRevisionOrThrow(branchId),
};

export function serializationFailure() {
  return new Prisma.PrismaClientKnownRequestError('Revision read conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

export async function createRevisionLookupTestKit() {
  const kit = await createDraftRevisionTestingModule();
  const internal = kit.module.get(DraftRevisionInternalService);
  const revisions = kit.module.get(RevisionsApiService);
  const branches = kit.module.get(BranchApiService);

  return {
    async givenReadFailure(error: Error) {
      const { draftRevisionId } = await prepareDraftRevisionTest(
        kit.prismaService,
      );
      const reads = jest
        .spyOn(revisions, 'revision')
        .mockRejectedValueOnce(error);
      const read = () => internal.findRevisionOrThrow(draftRevisionId);

      return {
        draftRevisionId,
        reads,
        read: () => kit.transactionService.run(read),
        readSerializable: () => kit.transactionService.runSerializable(read),
      };
    },
    async givenBranchLookup(lookup: BranchRevisionLookup) {
      const { branchId } = await prepareDraftRevisionTest(kit.prismaService);

      return {
        find: () =>
          kit.transactionService.run(() => lookup.find(internal, branchId)),
        failOnceWith(error: Error) {
          jest.spyOn(branches, lookup.read).mockRejectedValueOnce(error);
        },
        async loseRecord() {
          await kit.prismaService.revision.updateMany({
            where: { branchId },
            data: lookup.missingRecord,
          });
        },
      };
    },
    close: () => kit.module.close(),
  };
}
