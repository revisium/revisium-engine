import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import {
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
}
