import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
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
import {
  ResolveCandidateDependenciesQuery,
  type ResolveCandidateDependenciesQueryData,
  type ResolveCandidateDependenciesResult,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import {
  RecomputeCandidateFormulasQuery,
  type RecomputeCandidateFormulasQueryData,
  type RecomputeCandidateFormulasResult,
} from 'src/features/draft-changes/queries/impl/recompute-candidate-formulas.query';
import {
  PrepareCandidateFilesQuery,
  type PrepareCandidateFilesQueryData,
  type PrepareCandidateFilesResult,
} from 'src/features/draft-changes/queries/impl/prepare-candidate-files.query';
import {
  ResolveCandidateViewsQuery,
  type ResolveCandidateViewsQueryData,
  type ResolveCandidateViewsResult,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-views.query';
import {
  ApplyCandidateFilesCommand,
  type ApplyCandidateFilesCommandData,
} from 'src/features/draft-changes/commands/impl/apply-candidate-files.command';
import {
  ReadDraftChangesQuery,
  type ReadDraftChangesQueryData,
  type ReadDraftChangesResult,
} from 'src/features/draft-changes/queries/impl/read-draft-changes.query';
import {
  ReadDraftChangedTablesQuery,
  type ReadDraftChangedTablesQueryData,
  type ReadDraftChangedTablesResult,
} from 'src/features/draft-changes/queries/impl/read-draft-changed-tables.query';
import {
  ReadDraftChangedRowsQuery,
  type ReadDraftChangedRowsQueryData,
  type ReadDraftChangedRowsResult,
} from 'src/features/draft-changes/queries/impl/read-draft-changed-rows.query';
import {
  ReadDraftTableChangesQuery,
  type ReadDraftTableChangesQueryData,
  type ReadDraftTableChangesResult,
} from 'src/features/draft-changes/queries/impl/read-draft-table-changes.query';
import {
  ReadDraftRowChangesQuery,
  type ReadDraftRowChangesQueryData,
  type ReadDraftRowChangesResult,
} from 'src/features/draft-changes/queries/impl/read-draft-row-changes.query';

@Injectable()
export class DraftChangesApiService {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

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

  resolveCandidateDependencies(
    data: ResolveCandidateDependenciesQueryData,
  ): Promise<ResolveCandidateDependenciesResult> {
    return this.queryBus.execute<
      ResolveCandidateDependenciesQuery,
      ResolveCandidateDependenciesResult
    >(new ResolveCandidateDependenciesQuery(data));
  }

  recomputeCandidateFormulas(
    data: RecomputeCandidateFormulasQueryData,
  ): Promise<RecomputeCandidateFormulasResult> {
    return this.queryBus.execute<
      RecomputeCandidateFormulasQuery,
      RecomputeCandidateFormulasResult
    >(new RecomputeCandidateFormulasQuery(data));
  }

  prepareCandidateFiles(
    data: PrepareCandidateFilesQueryData,
  ): Promise<PrepareCandidateFilesResult> {
    return this.queryBus.execute<
      PrepareCandidateFilesQuery,
      PrepareCandidateFilesResult
    >(new PrepareCandidateFilesQuery(data));
  }

  resolveCandidateViews(
    data: ResolveCandidateViewsQueryData,
  ): Promise<ResolveCandidateViewsResult> {
    return this.queryBus.execute<
      ResolveCandidateViewsQuery,
      ResolveCandidateViewsResult
    >(new ResolveCandidateViewsQuery(data));
  }

  applyCandidateFiles(data: ApplyCandidateFilesCommandData): Promise<true> {
    return this.commandBus.execute<ApplyCandidateFilesCommand, true>(
      new ApplyCandidateFilesCommand(data),
    );
  }

  draftChanges(
    data: ReadDraftChangesQueryData,
  ): Promise<ReadDraftChangesResult> {
    return this.queryBus.execute<ReadDraftChangesQuery, ReadDraftChangesResult>(
      new ReadDraftChangesQuery(data),
    );
  }

  draftChangedTables(
    data: ReadDraftChangedTablesQueryData,
  ): Promise<ReadDraftChangedTablesResult> {
    return this.queryBus.execute<
      ReadDraftChangedTablesQuery,
      ReadDraftChangedTablesResult
    >(new ReadDraftChangedTablesQuery(data));
  }

  draftChangedRows(
    data: ReadDraftChangedRowsQueryData,
  ): Promise<ReadDraftChangedRowsResult> {
    return this.queryBus.execute<
      ReadDraftChangedRowsQuery,
      ReadDraftChangedRowsResult
    >(new ReadDraftChangedRowsQuery(data));
  }

  draftTableChanges(
    data: ReadDraftTableChangesQueryData,
  ): Promise<ReadDraftTableChangesResult> {
    return this.queryBus.execute<
      ReadDraftTableChangesQuery,
      ReadDraftTableChangesResult
    >(new ReadDraftTableChangesQuery(data));
  }

  draftRowChanges(
    data: ReadDraftRowChangesQueryData,
  ): Promise<ReadDraftRowChangesResult> {
    return this.queryBus.execute<
      ReadDraftRowChangesQuery,
      ReadDraftRowChangesResult
    >(new ReadDraftRowChangesQuery(data));
  }
}
