import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  type CommitChangesInput,
  type CommitChangesResult,
  CommitDraftChangesCommand,
} from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import {
  type RevertChangesInput,
  type RevertChangesResult,
  RevertDraftChangesCommand,
} from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import {
  type DraftChangesSummary,
  type DraftChangesSummaryInput,
  GetDraftChangesSummaryQuery,
} from 'src/features/partial-changes/queries/impl/get-draft-changes-summary.query';
import {
  type DraftTableChangesInput,
  type DraftTablePage,
  GetDraftTableChangesQuery,
} from 'src/features/partial-changes/queries/impl/get-draft-table-changes.query';
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

  public commitChanges(data: CommitChangesInput): Promise<CommitChangesResult> {
    return this.commandBus.execute(new CommitDraftChangesCommand(data));
  }

  public revertChanges(data: RevertChangesInput): Promise<RevertChangesResult> {
    return this.commandBus.execute(new RevertDraftChangesCommand(data));
  }

  public draftTableChanges(
    data: DraftTableChangesInput,
  ): Promise<DraftTablePage> {
    return this.queryBus.execute(new GetDraftTableChangesQuery(data));
  }

  public draftChangesSummary(
    data: DraftChangesSummaryInput,
  ): Promise<DraftChangesSummary> {
    return this.queryBus.execute(new GetDraftChangesSummaryQuery(data));
  }
}
