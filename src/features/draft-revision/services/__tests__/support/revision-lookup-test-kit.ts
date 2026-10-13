import { Prisma } from 'src/__generated__/client';
import {
  createDraftRevisionTestingModule,
  prepareDraftRevisionTest,
} from 'src/features/draft-revision/commands/handlers/__tests__/utils';
import { DraftRevisionInternalService } from 'src/features/draft-revision/services/draft-revision-internal.service';
import { RevisionsApiService } from 'src/features/revision/revisions-api.service';

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
    close: () => kit.module.close(),
  };
}
