import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RevisionsApiService } from 'src/features/revision';
import { DraftWriteAdmissionService } from 'src/features/draft/draft-write-admission.service';
import {
  ApiCreateRevisionCommand,
  ApiCreateRevisionCommandReturnType,
} from 'src/features/draft/commands/impl/api-create-revision.command';
import { CreateRevisionCommand } from 'src/features/draft/commands/impl/create-revision.command';
import { CreateRevisionHandlerReturnType } from 'src/features/draft/commands/types/create-revision.handler.types';

@CommandHandler(ApiCreateRevisionCommand)
export class ApiCreateRevisionHandler implements ICommandHandler<
  ApiCreateRevisionCommand,
  ApiCreateRevisionCommandReturnType
> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly revisionApi: RevisionsApiService,
    private readonly draftWriteAdmission: DraftWriteAdmissionService,
  ) {}

  async execute({ data }: ApiCreateRevisionCommand) {
    const {
      previousDraftRevisionId,
      previousHeadRevisionId,
    }: CreateRevisionHandlerReturnType =
      await this.draftWriteAdmission.runSerializableCommit(
        data.projectId,
        data.branchName,
        async () =>
          this.commandBus.execute<
            CreateRevisionCommand,
            CreateRevisionHandlerReturnType
          >(new CreateRevisionCommand(data)),
      );

    const revision = await this.revisionApi.revision({
      revisionId: previousDraftRevisionId,
    });

    return {
      ...revision,
      previousHeadRevisionId,
      previousDraftRevisionId,
    };
  }
}
