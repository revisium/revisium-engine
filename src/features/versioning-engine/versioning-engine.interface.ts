import type { ApiCreateBranchByRevisionIdCommandData } from 'src/features/branch/commands/impl/api-create-branch-by-revision-id.command';
import type {
  ApiRevertChangesCommandData,
  ApiRevertChangesCommandReturnType,
} from 'src/features/draft/commands/impl/api-revert-changes.command';
import type {
  ApiCreateRevisionCommandData,
  ApiCreateRevisionCommandReturnType,
} from 'src/features/draft/commands/impl/api-create-revision.command';
import type {
  GetRowsQueryData,
  GetRowsQueryReturnType,
} from 'src/features/row/queries/impl/get-rows.query';

export interface VersioningEngine {
  getRows(data: GetRowsQueryData): Promise<GetRowsQueryReturnType>;
  createRevision(
    data: ApiCreateRevisionCommandData,
  ): Promise<ApiCreateRevisionCommandReturnType>;
  revertChanges(
    data: ApiRevertChangesCommandData,
  ): Promise<ApiRevertChangesCommandReturnType>;
  createBranch(
    data: ApiCreateBranchByRevisionIdCommandData,
  ): Promise<{ id: string }>;
}
