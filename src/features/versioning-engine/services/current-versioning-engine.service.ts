import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { BranchApiService } from 'src/features/branch/branch-api.service';
import type { ApiCreateBranchByRevisionIdCommandData } from 'src/features/branch/commands/impl/api-create-branch-by-revision-id.command';
import { DraftApiService } from 'src/features/draft/draft-api.service';
import type {
  ApiRevertChangesCommandData,
  ApiRevertChangesCommandReturnType,
} from 'src/features/draft/commands/impl/api-revert-changes.command';
import { ApiRevertChangesCommand } from 'src/features/draft/commands/impl/api-revert-changes.command';
import type {
  ApiCreateRevisionCommandData,
  ApiCreateRevisionCommandReturnType,
} from 'src/features/draft/commands/impl/api-create-revision.command';
import { RowApiService } from 'src/features/row/row-api.service';
import type {
  GetRowsQueryData,
  GetRowsQueryReturnType,
} from 'src/features/row/queries/impl/get-rows.query';
import { VersioningEngine } from 'src/features/versioning-engine/versioning-engine.interface';

@Injectable()
export class CurrentVersioningEngineService implements VersioningEngine {
  constructor(
    private readonly rowApi: RowApiService,
    private readonly draftApi: DraftApiService,
    private readonly branchApi: BranchApiService,
    private readonly commandBus: CommandBus,
  ) {}

  getRows(data: GetRowsQueryData): Promise<GetRowsQueryReturnType> {
    return this.rowApi.getRows(data);
  }

  createRevision(
    data: ApiCreateRevisionCommandData,
  ): Promise<ApiCreateRevisionCommandReturnType> {
    return this.draftApi.apiCreateRevision(data);
  }

  revertChanges(
    data: ApiRevertChangesCommandData,
  ): Promise<ApiRevertChangesCommandReturnType> {
    return this.commandBus.execute<
      ApiRevertChangesCommand,
      ApiRevertChangesCommandReturnType
    >(new ApiRevertChangesCommand(data));
  }

  async createBranch(
    data: ApiCreateBranchByRevisionIdCommandData,
  ): Promise<{ id: string }> {
    const branch = await this.branchApi.apiCreateBranchByRevisionId(data);
    return { id: branch.id };
  }
}
