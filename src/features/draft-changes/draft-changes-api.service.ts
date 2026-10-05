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
  ApplyCandidateFilesCommand,
  type ApplyCandidateFilesCommandData,
} from 'src/features/draft-changes/commands/impl/apply-candidate-files.command';

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

  applyCandidateFiles(data: ApplyCandidateFilesCommandData): Promise<true> {
    return this.commandBus.execute<ApplyCandidateFilesCommand, true>(
      new ApplyCandidateFilesCommand(data),
    );
  }
}
