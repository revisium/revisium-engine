import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
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
  constructor(private readonly queryBus: QueryBus) {}

  public listChanges(data: ListChangesInput): Promise<ListChangesResult> {
    return this.queryBus.execute(new ListDraftChangesQuery(data));
  }

  public previewChanges(
    data: PreviewChangesInput,
  ): Promise<PreviewChangesResult> {
    return this.queryBus.execute(new PreviewDraftChangesQuery(data));
  }
}
