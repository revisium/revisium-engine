import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  CommitChangesCommand,
  CommitChangesCommandReturnType,
} from 'src/features/partial-changes-poc/commands/impl/commit-changes.command';
import {
  RevertPartialChangesCommand,
  RevertPartialChangesCommandReturnType,
} from 'src/features/partial-changes-poc/commands/impl/revert-changes.command';
import {
  CommitChangesInput,
  ListChangesInput,
  PreviewChangesInput,
  RevertChangesInput,
} from 'src/features/partial-changes-poc/partial-changes.types';
import {
  ListChangesQuery,
  ListChangesQueryReturnType,
} from 'src/features/partial-changes-poc/queries/impl/list-changes.query';
import {
  PreviewChangesQuery,
  PreviewChangesQueryReturnType,
} from 'src/features/partial-changes-poc/queries/impl/preview-changes.query';

@Injectable()
export class PartialChangesApiService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  public listChanges(data: ListChangesInput) {
    return this.queryBus.execute<ListChangesQuery, ListChangesQueryReturnType>(
      new ListChangesQuery(data),
    );
  }

  public previewChanges(data: PreviewChangesInput) {
    return this.queryBus.execute<
      PreviewChangesQuery,
      PreviewChangesQueryReturnType
    >(new PreviewChangesQuery(data));
  }

  public commitChanges(data: CommitChangesInput) {
    return this.commandBus.execute<
      CommitChangesCommand,
      CommitChangesCommandReturnType
    >(new CommitChangesCommand(data));
  }

  public revertChanges(data: RevertChangesInput) {
    return this.commandBus.execute<
      RevertPartialChangesCommand,
      RevertPartialChangesCommandReturnType
    >(new RevertPartialChangesCommand(data));
  }
}
