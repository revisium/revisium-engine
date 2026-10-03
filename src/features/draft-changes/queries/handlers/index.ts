import { ReadDraftChangesSnapshotHandler } from 'src/features/draft-changes/queries/handlers/read-draft-changes-snapshot.handler';
import { ProjectDraftChangesSchemaHandler } from 'src/features/draft-changes/queries/handlers/project-draft-changes-schema.handler';

export const DRAFT_CHANGES_QUERY_HANDLERS = [
  ReadDraftChangesSnapshotHandler,
  ProjectDraftChangesSchemaHandler,
];
