import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  ApiCreateRevisionCommand,
  ApiCreateRevisionCommandReturnType,
} from 'src/features/draft/commands/impl/api-create-revision.command';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';

describe('ApiCreateRevisionHandler', () => {
  let kit: DraftTestKit;

  it('should create a new draft revision', async () => {
    const draft = await givenDraftProject(kit.prismaService);

    await kit.prismaService.revision.update({
      where: {
        id: draft.draftRevisionId,
      },
      data: {
        hasChanges: true,
      },
    });

    const command = new ApiCreateRevisionCommand({
      projectId: draft.projectId,
      branchName: draft.branchName,
      comment: 'comment',
    });

    const result = await execute(command);

    const committedHeadRevision =
      await kit.prismaService.revision.findUniqueOrThrow({
        where: { id: draft.draftRevisionId },
      });
    expect(committedHeadRevision.isHead).toBe(true);
    expect(committedHeadRevision.isDraft).toBe(false);

    const { previousHeadRevisionId, previousDraftRevisionId, ...revision } =
      result;
    expect(revision).toStrictEqual(committedHeadRevision);
    expect(previousDraftRevisionId).toBe(draft.draftRevisionId);
    expect(typeof previousHeadRevisionId).toBe('string');
  });

  function execute(
    command: ApiCreateRevisionCommand,
  ): Promise<ApiCreateRevisionCommandReturnType> {
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
