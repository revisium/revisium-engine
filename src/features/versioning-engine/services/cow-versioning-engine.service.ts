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
  private notImplemented(): never {
    throw new NotImplementedException(
      'COW versioning engine is not implemented yet',
    );
  }

  getRows(_data: GetRowsQueryData): Promise<GetRowsQueryReturnType> {
    return this.notImplemented();
  }

  createRevision(
    _data: ApiCreateRevisionCommandData,
  ): Promise<ApiCreateRevisionCommandReturnType> {
    return this.notImplemented();
  }

  revertChanges(
    _data: ApiRevertChangesCommandData,
  ): Promise<ApiRevertChangesCommandReturnType> {
    return this.notImplemented();
  }

  createBranch(
    _data: ApiCreateBranchByRevisionIdCommandData,
  ): Promise<{ id: string }> {
    return this.notImplemented();
  }
}
