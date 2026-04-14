import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  ApiRevertChangesCommand,
  ApiRevertChangesCommandReturnType,
} from 'src/features/draft/commands/impl/api-revert-changes.command';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiRevertChangesHandler', () => {
  let kit: DraftTestKit;

  it('should revert changes', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    await kit.prismaService.revision.update({
      where: {
        id: draft.draftRevisionId,
      },
      data: {
        hasChanges: true,
      },
    });

    const command = new ApiRevertChangesCommand({
      projectId: draft.projectId,
      branchName: draft.branchName,
    });

    const result = await execute(command);

    expect(result.id).toStrictEqual(draft.branchId);
  });

  function execute(
    command: ApiRevertChangesCommand,
  ): Promise<ApiRevertChangesCommandReturnType> {
    return kit.commandBus.execute(command);
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
