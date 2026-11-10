import { GetDraftChangesSummaryHandler } from 'src/features/partial-changes/queries/handlers/get-draft-changes-summary.handler';
import { GetDraftTableChangesHandler } from 'src/features/partial-changes/queries/handlers/get-draft-table-changes.handler';
import { ListDraftChangesHandler } from 'src/features/partial-changes/queries/handlers/list-draft-changes.handler';
import { PreviewDraftChangesHandler } from 'src/features/partial-changes/queries/handlers/preview-draft-changes.handler';

export const PARTIAL_CHANGES_QUERY_HANDLERS = [
  ListDraftChangesHandler,
  PreviewDraftChangesHandler,
  GetDraftTableChangesHandler,
  GetDraftChangesSummaryHandler,
];
