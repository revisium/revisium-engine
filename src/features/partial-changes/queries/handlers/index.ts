import { GetDraftChangesSummaryHandler } from 'src/features/partial-changes/queries/handlers/get-draft-changes-summary.handler';
import { GetDraftRowChangesHandler } from 'src/features/partial-changes/queries/handlers/get-draft-row-changes.handler';
import { GetDraftTableChangesHandler } from 'src/features/partial-changes/queries/handlers/get-draft-table-changes.handler';
import { PreviewDraftChangesHandler } from 'src/features/partial-changes/queries/handlers/preview-draft-changes.handler';

export const PARTIAL_CHANGES_QUERY_HANDLERS = [
  PreviewDraftChangesHandler,
  GetDraftTableChangesHandler,
  GetDraftRowChangesHandler,
  GetDraftChangesSummaryHandler,
];
