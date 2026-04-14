import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';
import { RevertChangesCommand } from 'src/features/draft/commands/impl/revert-changes.command';
import { RevertChangesHandlerReturnType } from 'src/features/draft/commands/types/revert-changes.handler.types';

describe('RevertChangesHandler', () => {
  let kit: DraftTestKit;

  it('should throw an error if the branch does not exist in the project', async () => {
    const { projectId, branchName } = await givenDraftProject(
      kit.prismaService,
    );

    jest
      .spyOn(kit.shareTransactionalQueries, 'findBranchInProjectOrThrow')
      .mockRejectedValue(new Error('Branch not found'));

    const command = new RevertChangesCommand({
      projectId,
      branchName,
    });

    await expect(runTransaction(command)).rejects.toThrow('Branch not found');
  });

  it('should revert changes if there are changes', async () => {
    const draft = await givenDraftProject(kit.prismaService);
    const { projectId, branchId, branchName, draftRevisionId } = draft;
    await prepareRevision(draftRevisionId);

    const command = new RevertChangesCommand({
      projectId,
      branchName,
    });
    const result = await runTransaction(command);

    expect(result.branchId).toBe(branchId);
    expect(result.draftRevisionId).toBe(draftRevisionId);
  });

  async function prepareRevision(draftRevisionId: string) {
    await kit.prismaService.revision.update({
      where: { id: draftRevisionId },
      data: { hasChanges: true },
    });
  }

  function runTransaction(
    command: RevertChangesCommand,
  ): Promise<RevertChangesHandlerReturnType> {
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
