import { ReadDraftChangesSnapshotHandler } from 'src/features/draft-changes/queries/handlers/read-draft-changes-snapshot.handler';
import { ProjectDraftChangesSchemaHandler } from 'src/features/draft-changes/queries/handlers/project-draft-changes-schema.handler';
import { BuildDraftChangesCatalogueHandler } from './build-draft-changes-catalogue.handler';
import { ResolveDraftChangesSelectionHandler } from './resolve-draft-changes-selection.handler';
import { CalculateDataCandidatesHandler } from './calculate-data-candidates.handler';
import { ResolveCandidateDependenciesHandler } from './resolve-candidate-dependencies.handler';
import { RecomputeCandidateFormulasHandler } from './recompute-candidate-formulas.handler';
import { PrepareCandidateFilesHandler } from './prepare-candidate-files.handler';
import { ResolveCandidateViewsHandler } from './resolve-candidate-views.handler';
import { ReadDraftChangesHandler } from './read-draft-changes.handler';
import { ReadDraftChangedTablesHandler } from './read-draft-changed-tables.handler';
import { ReadDraftChangedRowsHandler } from './read-draft-changed-rows.handler';
import { ReadDraftTableChangesHandler } from './read-draft-table-changes.handler';
import { ReadDraftRowChangesHandler } from './read-draft-row-changes.handler';

export const DRAFT_CHANGES_QUERY_HANDLERS = [
  ReadDraftChangesSnapshotHandler,
  ProjectDraftChangesSchemaHandler,
  BuildDraftChangesCatalogueHandler,
  ResolveDraftChangesSelectionHandler,
  CalculateDataCandidatesHandler,
  ResolveCandidateDependenciesHandler,
  RecomputeCandidateFormulasHandler,
  PrepareCandidateFilesHandler,
  ResolveCandidateViewsHandler,
  ReadDraftChangesHandler,
  ReadDraftChangedTablesHandler,
  ReadDraftChangedRowsHandler,
  ReadDraftTableChangesHandler,
  ReadDraftRowChangesHandler,
];
