import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import {
  DraftRevisionCommitToTargetCommand,
  DraftRevisionCommitToTargetCommandData,
  DraftRevisionCommitToTargetCommandReturnType,
  DraftRevisionRevertToTargetCommand,
  DraftRevisionRevertToTargetCommandData,
  DraftRevisionRevertToTargetCommandReturnType,
  DraftRowVersionsReplacement,
  TargetWritePlan,
} from 'src/features/draft-revision/commands/impl';

@Injectable()
export class DraftRevisionTargetApiService {
  constructor(private readonly commandBus: CommandBus) {}

  public revertToTarget(
    data: DraftRevisionRevertToTargetCommandData,
  ): Promise<DraftRevisionRevertToTargetCommandReturnType> {
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

  public async replaceDraftRowVersions(
    replacement: DraftRowVersionsReplacement,
  ): Promise<string> {
    const { draftRevisionId } = await this.revertToTarget(
      draftRowVersionsPlanOf(replacement),
    );

    return draftRevisionId;
  }
}

function draftRowVersionsPlanOf({
  headRevisionId,
  draftRevisionId,
  tableId,
  draftTableVersionId,
  editInPlace,
  replacedRowVersionIds,
  newRows,
}: DraftRowVersionsReplacement): TargetWritePlan {
  return {
    headRevisionId,
    draftRevisionId,
    tables: [
      {
        identity: tableId,
        draftVersionId: draftTableVersionId,
        target: {
          kind: 'mixed',
          tableId,
          sourceVersionId: draftTableVersionId,
          editInPlace,
          hasFileFields: false,
          removedRowVersionIds: replacedRowVersionIds,
          addedRowVersionIds: [],
          newRows,
        },
        relinkCandidate: false,
      },
    ],
  };
}
