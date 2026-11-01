import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  type RevertChangesInput,
  type RevertChangesResult,
  RevertDraftChangesCommand,
} from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import {
  type ListChangesInput,
  type ListChangesResult,
  ListDraftChangesQuery,
} from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import {
  type PreviewChangesInput,
  type PreviewChangesResult,
  PreviewDraftChangesQuery,
} from 'src/features/partial-changes/queries/impl/preview-draft-changes.query';

@Injectable()
export class PartialChangesApiService {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  public listChanges(data: ListChangesInput): Promise<ListChangesResult> {
    return this.queryBus.execute(new ListDraftChangesQuery(data));
  }

  public previewChanges(
    data: PreviewChangesInput,
  ): Promise<PreviewChangesResult> {
    return this.queryBus.execute(new PreviewDraftChangesQuery(data));
  }

  public revertChanges(data: RevertChangesInput): Promise<RevertChangesResult> {
    return this.commandBus.execute(new RevertDraftChangesCommand(data));
  }
}
