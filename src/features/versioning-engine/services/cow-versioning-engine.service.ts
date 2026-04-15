import { Injectable, NotImplementedException } from '@nestjs/common';
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
import { VersioningEngine } from 'src/features/versioning-engine/versioning-engine.interface';

@Injectable()
export class CowVersioningEngineService implements VersioningEngine {
  getRows(_data: GetRowsQueryData): Promise<GetRowsQueryReturnType> {
    throw new NotImplementedException('COW versioning engine is not implemented yet');
  }

  createRevision(
    _data: ApiCreateRevisionCommandData,
  ): Promise<ApiCreateRevisionCommandReturnType> {
    throw new NotImplementedException('COW versioning engine is not implemented yet');
  }

  revertChanges(
    _data: ApiRevertChangesCommandData,
  ): Promise<ApiRevertChangesCommandReturnType> {
    throw new NotImplementedException('COW versioning engine is not implemented yet');
  }

  createBranch(
    _data: ApiCreateBranchByRevisionIdCommandData,
  ): Promise<{ id: string }> {
    throw new NotImplementedException('COW versioning engine is not implemented yet');
  }
}
