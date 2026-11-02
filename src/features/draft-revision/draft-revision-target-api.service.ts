import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import {
  DraftRevisionCommitToTargetCommand,
  DraftRevisionCommitToTargetCommandData,
  DraftRevisionCommitToTargetCommandReturnType,
  DraftRevisionRevertToTargetCommand,
  DraftRevisionRevertToTargetCommandData,
  DraftRowVersionsReplacement,
  TargetWritePlan,
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

  public replaceDraftRowVersions(
    replacement: DraftRowVersionsReplacement,
  ): Promise<string> {
    return this.commandBus.execute(
      new DraftRevisionRevertToTargetCommand(
        draftRowVersionsPlanOf(replacement),
      ),
    );
  }
}

function draftRowVersionsPlanOf({
  headRevisionId,
  draftRevisionId,
  tableId,
  draftTableVersionId,
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
          // The replaced rows are Draft-only, so the Draft table version that holds them is its own mutable copy.
          editInPlace: true,
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
