import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import {
  DraftChangesSnapshot,
  ReadDraftChangesSnapshotQuery,
  ReadDraftChangesSnapshotQueryData,
} from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';

@Injectable()
export class DraftChangesApiService {
  constructor(private readonly queryBus: QueryBus) {}

  readSnapshot(
    data: ReadDraftChangesSnapshotQueryData,
  ): Promise<DraftChangesSnapshot> {
    return this.queryBus.execute<
      ReadDraftChangesSnapshotQuery,
      DraftChangesSnapshot
    >(new ReadDraftChangesSnapshotQuery(data));
  }
}
