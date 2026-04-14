import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';
import { CreateRevisionCommand } from 'src/features/draft/commands/impl/create-revision.command';
import { CreateRevisionHandlerReturnType } from 'src/features/draft/commands/types/create-revision.handler.types';

describe('CreateRevisionHandler', () => {
  let kit: DraftTestKit;

  it('should throw an error if the branch does not exist in the project', async () => {
    const draft = await givenDraftProject(kit.prismaService);
    const { projectId, branchName } = draft;
    await prepareRevision(draft.draftRevisionId);

    jest
      .spyOn(kit.shareTransactionalQueries, 'findBranchInProjectOrThrow')
      .mockRejectedValue(new Error('Branch not found'));

    const command = new CreateRevisionCommand({
      projectId,
      branchName,
    });

    await expect(runTransaction(command)).rejects.toThrow('Branch not found');
  });

  it('should create a new draft revision if there are changes', async () => {
    const draft = await givenDraftProject(kit.prismaService);
    const { projectId, branchName, headRevisionId, draftRevisionId } = draft;
    await prepareRevision(draftRevisionId);

    const command = new CreateRevisionCommand({
      projectId,
      branchName,
      comment: 'comment',
    });
    const result = await runTransaction(command);

    expect(result.previousDraftRevisionId).toEqual(draftRevisionId);
    expect(result.previousHeadRevisionId).toEqual(headRevisionId);
    expect(result.nextDraftRevisionId).not.toEqual(draftRevisionId);
  });

  async function prepareRevision(draftRevisionId: string) {
    await kit.prismaService.revision.update({
      where: { id: draftRevisionId },
      data: { hasChanges: true },
    });
  }

  function runTransaction(
    command: CreateRevisionCommand,
  ): Promise<CreateRevisionHandlerReturnType> {
    return kit.transactionService.run(async () =>
      kit.commandBus.execute(command),
    );
  }

  beforeAll(async () => {
    kit = await createTestingModule();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (kit) {
      await kit.close();
    }
  });
});
