import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import {
  DraftChangesSnapshot,
  ReadDraftChangesSnapshotQuery,
  ReadDraftChangesSnapshotQueryData,
} from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import {
  ProjectDraftChangesSchemaQuery,
  ProjectDraftChangesSchemaQueryData,
  ProjectDraftChangesSchemaResult,
} from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';

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

  projectSchema(
    data: ProjectDraftChangesSchemaQueryData,
  ): Promise<ProjectDraftChangesSchemaResult> {
    return this.queryBus.execute<
      ProjectDraftChangesSchemaQuery,
      ProjectDraftChangesSchemaResult
    >(new ProjectDraftChangesSchemaQuery(data));
  }
}
