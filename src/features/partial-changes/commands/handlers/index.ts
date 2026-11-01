import { CommitDraftChangesHandler } from 'src/features/partial-changes/commands/handlers/commit-draft-changes.handler';
import { RevertDraftChangesHandler } from 'src/features/partial-changes/commands/handlers/revert-draft-changes.handler';

export const PARTIAL_CHANGES_COMMAND_HANDLERS = [
  CommitDraftChangesHandler,
  RevertDraftChangesHandler,
];
