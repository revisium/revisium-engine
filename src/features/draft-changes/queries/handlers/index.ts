import { ReadDraftChangesSnapshotHandler } from 'src/features/draft-changes/queries/handlers/read-draft-changes-snapshot.handler';
import { ProjectDraftChangesSchemaHandler } from 'src/features/draft-changes/queries/handlers/project-draft-changes-schema.handler';
import { BuildDraftChangesCatalogueHandler } from './build-draft-changes-catalogue.handler';
import { ResolveDraftChangesSelectionHandler } from './resolve-draft-changes-selection.handler';
import { CalculateDataCandidatesHandler } from './calculate-data-candidates.handler';

export const DRAFT_CHANGES_QUERY_HANDLERS = [
  ReadDraftChangesSnapshotHandler,
  ProjectDraftChangesSchemaHandler,
  BuildDraftChangesCatalogueHandler,
  ResolveDraftChangesSelectionHandler,
  CalculateDataCandidatesHandler,
];
