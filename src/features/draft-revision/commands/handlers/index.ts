import { DraftRevisionCommitHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-commit.handler';
import { DraftRevisionCommitToTargetHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-commit-to-target.handler';
import { DraftRevisionCreateRowsHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-create-rows.handler';
import { DraftRevisionCreateTableHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-create-table.handler';
import { DraftRevisionGetOrCreateDraftRowHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-get-or-create-draft-row.handler';
import { DraftRevisionGetOrCreateDraftTableHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-get-or-create-draft-table.handler';
import { DraftRevisionRecomputeHasChangesHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-recompute-has-changes.handler';
import { DraftRevisionRemoveRowsHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-remove-rows.handler';
import { DraftRevisionRemoveTableHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-remove-table.handler';
import { DraftRevisionRenameRowsHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-rename-rows.handler';
import { DraftRevisionRenameTableHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-rename-table.handler';
import { DraftRevisionRevertHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-revert.handler';
import { DraftRevisionRevertToTargetHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-revert-to-target.handler';
import { DraftRevisionUpdateRowsHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-update-rows.handler';

export const DRAFT_REVISION_COMMANDS_HANDLERS = [
  DraftRevisionCreateTableHandler,
  DraftRevisionRemoveTableHandler,
  DraftRevisionRenameTableHandler,
  DraftRevisionGetOrCreateDraftTableHandler,
  DraftRevisionCreateRowsHandler,
  DraftRevisionUpdateRowsHandler,
  DraftRevisionRenameRowsHandler,
  DraftRevisionRemoveRowsHandler,
  DraftRevisionGetOrCreateDraftRowHandler,
  DraftRevisionCommitHandler,
  DraftRevisionRevertHandler,
  DraftRevisionRecomputeHasChangesHandler,
  DraftRevisionRevertToTargetHandler,
  DraftRevisionCommitToTargetHandler,
];

export { DraftRevisionCreateTableHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-create-table.handler';
export { DraftRevisionRemoveTableHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-remove-table.handler';
export { DraftRevisionRenameTableHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-rename-table.handler';
export { DraftRevisionGetOrCreateDraftTableHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-get-or-create-draft-table.handler';
export { DraftRevisionCreateRowsHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-create-rows.handler';
export { DraftRevisionUpdateRowsHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-update-rows.handler';
export { DraftRevisionRenameRowsHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-rename-rows.handler';
export { DraftRevisionRemoveRowsHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-remove-rows.handler';
export { DraftRevisionGetOrCreateDraftRowHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-get-or-create-draft-row.handler';
export { DraftRevisionCommitHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-commit.handler';
export { DraftRevisionRevertHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-revert.handler';
export { DraftRevisionRecomputeHasChangesHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-recompute-has-changes.handler';
export { DraftRevisionRevertToTargetHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-revert-to-target.handler';
export { DraftRevisionCommitToTargetHandler } from 'src/features/draft-revision/commands/handlers/draft-revision-commit-to-target.handler';
