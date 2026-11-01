import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import {
  type ListChangesInput,
  type ListChangesResult,
  ListDraftChangesQuery,
} from 'src/features/partial-changes/queries/impl/list-draft-changes.query';

@Injectable()
export class PartialChangesApiService {
  constructor(private readonly queryBus: QueryBus) {}

  public listChanges(data: ListChangesInput): Promise<ListChangesResult> {
    return this.queryBus.execute(new ListDraftChangesQuery(data));
  }
}
