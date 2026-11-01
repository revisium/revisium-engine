import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import {
  DraftRevisionCommitToTargetCommand,
  DraftRevisionCommitToTargetCommandData,
  DraftRevisionCommitToTargetCommandReturnType,
  DraftRevisionRevertToTargetCommand,
  DraftRevisionRevertToTargetCommandData,
} from 'src/features/draft-revision/commands/impl';

@Injectable()
export class DraftRevisionTargetApiService {
  constructor(private readonly commandBus: CommandBus) {}

  public revertToTarget(
    data: DraftRevisionRevertToTargetCommandData,
  ): Promise<string> {
    return this.commandBus.execute(
      new DraftRevisionRevertToTargetCommand(data),
    );
  }

  public commitToTarget(
    data: DraftRevisionCommitToTargetCommandData,
  ): Promise<DraftRevisionCommitToTargetCommandReturnType> {
    return this.commandBus.execute(
      new DraftRevisionCommitToTargetCommand(data),
    );
  }
}
