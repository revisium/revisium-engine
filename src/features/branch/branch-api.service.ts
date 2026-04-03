import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiCreateBranchByRevisionIdCommand,
  ApiCreateBranchByRevisionIdCommandData,
  DeleteBranchCommand,
  DeleteBranchCommandData,
} from 'src/features/branch/commands/impl';
import {
  GetBranchByIdQuery,
  GetBranchByIdQueryData,
  GetBranchByIdQueryReturnType,
  GetBranchesQuery,
  GetBranchesQueryData,
  GetBranchesQueryReturnType,
  GetBranchQuery,
  GetBranchQueryData,
  GetDraftRevisionQuery,
  GetHeadRevisionQuery,
  GetProjectByBranchQuery,
  GetRevisionsByBranchIdQuery,
  GetRevisionsByBranchIdQueryData,
  GetRevisionsByBranchIdQueryReturnType,
  GetStartRevisionQuery,
  GetTouchedByBranchIdQuery,
  ResolveParentBranchByBranchQuery,
  ResolveParentBranchByBranchQueryData,
} from 'src/features/branch/quieries/impl';
import {
  GetBranchReturnType,
  GetDraftRevisionTypes,
  GetHeadRevisionReturnType,
  GetStartRevisionReturnType,
} from 'src/features/branch/quieries/types';
import { GetBranchByIdReturnType } from 'src/features/branch/quieries/types/get-branch-by-id.types';

@Injectable()
export class BranchApiService {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  public getBranch(data: GetBranchQueryData) {
    return this.queryBus.execute<GetBranchQuery, GetBranchReturnType>(
      new GetBranchQuery(data),
    );
  }

  public getBranches(data: GetBranchesQueryData) {
    return this.queryBus.execute<GetBranchesQuery, GetBranchesQueryReturnType>(
      new GetBranchesQuery(data),
    );
  }

  public resolveParentBranch(data: ResolveParentBranchByBranchQueryData) {
    return this.queryBus.execute<
      ResolveParentBranchByBranchQuery,
      { branch: { id: string }; revision: { id: string } } | undefined
    >(new ResolveParentBranchByBranchQuery(data));
  }

  public getProjectByBranch(branchId: string) {
    return this.queryBus.execute<GetProjectByBranchQuery, { id: string }>(
      new GetProjectByBranchQuery(branchId),
    );
  }

  public getStartRevision(branchId: string) {
    return this.queryBus.execute<
      GetStartRevisionQuery,
      GetStartRevisionReturnType
    >(new GetStartRevisionQuery(branchId));
  }

  public getHeadRevision(branchId: string) {
    return this.queryBus.execute<
      GetHeadRevisionQuery,
      GetHeadRevisionReturnType
    >(new GetHeadRevisionQuery(branchId));
  }

  public getDraftRevision(branchId: string) {
    return this.queryBus.execute<GetDraftRevisionQuery, GetDraftRevisionTypes>(
      new GetDraftRevisionQuery(branchId),
    );
  }

  public getRevisionsByBranchId(data: GetRevisionsByBranchIdQueryData) {
    return this.queryBus.execute<
      GetRevisionsByBranchIdQuery,
      GetRevisionsByBranchIdQueryReturnType
    >(new GetRevisionsByBranchIdQuery(data));
  }

  public getTouchedByBranchId(branchId: string) {
    return this.queryBus.execute<GetTouchedByBranchIdQuery, boolean>(
      new GetTouchedByBranchIdQuery(branchId),
    );
  }

  public apiCreateBranchByRevisionId(
    data: ApiCreateBranchByRevisionIdCommandData,
  ) {
    return this.commandBus.execute<
      ApiCreateBranchByRevisionIdCommand,
      GetBranchByIdReturnType
    >(new ApiCreateBranchByRevisionIdCommand(data));
  }

  public getBranchById(data: GetBranchByIdQueryData) {
    return this.queryBus.execute<
      GetBranchByIdQuery,
      GetBranchByIdQueryReturnType
    >(new GetBranchByIdQuery(data));
  }

  public deleteBranch(data: DeleteBranchCommandData) {
    return this.commandBus.execute<DeleteBranchCommand, boolean>(
      new DeleteBranchCommand(data),
    );
  }
}
