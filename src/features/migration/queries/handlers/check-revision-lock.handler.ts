import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { CheckRevisionLockQuery } from 'src/features/migration/queries/impl/check-revision-lock.query';

@QueryHandler(CheckRevisionLockQuery)
export class CheckRevisionLockHandler implements IQueryHandler<
  CheckRevisionLockQuery,
  void
> {
  constructor(private readonly migrationLockService: MigrationLockService) {}

  execute({ data }: CheckRevisionLockQuery): Promise<void> {
    return this.migrationLockService.checkRevisionLock(data.revisionId);
  }
}
