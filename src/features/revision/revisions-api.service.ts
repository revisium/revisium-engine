import { Injectable } from '@nestjs/common';
import { InternalRevisionsApiService } from 'src/features/revision/internal-revisions-api.service';
import {
  GetChildrenByRevisionQueryData,
  GetMigrationsQueryData,
  GetRevisionQueryData,
  GetTablesByRevisionIdQueryData,
  ResolveBranchByRevisionQueryData,
  ResolveChildBranchesByRevisionQueryData,
  ResolveChildByRevisionQueryData,
  ResolveParentByRevisionQueryData,
} from 'src/features/revision/queries/impl';

@Injectable()
export class RevisionsApiService {
  constructor(private readonly api: InternalRevisionsApiService) {}

  public revision(data: GetRevisionQueryData) {
    return this.api.revision(data);
  }

  public migrations(data: GetMigrationsQueryData) {
    return this.api.migrations(data);
  }

  public resolveParentByRevision(data: ResolveParentByRevisionQueryData) {
    return this.api.resolveParentByRevision(data);
  }

  public resolveChildByRevision(data: ResolveChildByRevisionQueryData) {
    return this.api.resolveChildByRevision(data);
  }

  public resolveChildBranchesByRevision(
    data: ResolveChildBranchesByRevisionQueryData,
  ) {
    return this.api.resolveChildBranchesByRevision(data);
  }

  public getTablesByRevisionId(data: GetTablesByRevisionIdQueryData) {
    return this.api.getTablesByRevisionId(data);
  }

  public getChildrenByRevision(data: GetChildrenByRevisionQueryData) {
    return this.api.getChildrenByRevision(data);
  }

  public resolveBranchByRevision(data: ResolveBranchByRevisionQueryData) {
    return this.api.resolveBranchByRevision(data);
  }
}
