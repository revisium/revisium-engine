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
import {
  BuildDraftChangesCatalogueQuery,
  type BuildDraftChangesCatalogueQueryData,
  type BuildDraftChangesCatalogueResult,
  ResolveDraftChangesSelectionQuery,
  type ResolveDraftChangesSelectionQueryData,
  type ResolveDraftChangesSelectionResult,
} from 'src/features/draft-changes/queries/impl';
import {
  CalculateDataCandidatesQuery,
  type CalculateDataCandidatesQueryData,
  type CalculateDataCandidatesResult,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';

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

  buildCatalogue(
    data: BuildDraftChangesCatalogueQueryData,
  ): Promise<BuildDraftChangesCatalogueResult> {
    return this.queryBus.execute<
      BuildDraftChangesCatalogueQuery,
      BuildDraftChangesCatalogueResult
    >(new BuildDraftChangesCatalogueQuery(data));
  }

  resolveSelection(
    data: ResolveDraftChangesSelectionQueryData,
  ): Promise<ResolveDraftChangesSelectionResult> {
    return this.queryBus.execute<
      ResolveDraftChangesSelectionQuery,
      ResolveDraftChangesSelectionResult
    >(new ResolveDraftChangesSelectionQuery(data));
  }

  calculateDataCandidates(
    data: CalculateDataCandidatesQueryData,
  ): Promise<CalculateDataCandidatesResult> {
    return this.queryBus.execute<
      CalculateDataCandidatesQuery,
      CalculateDataCandidatesResult
    >(new CalculateDataCandidatesQuery(data));
  }
}
