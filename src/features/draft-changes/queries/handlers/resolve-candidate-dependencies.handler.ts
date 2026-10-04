import { QueryBus, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { resolveDependencyClosure } from 'src/features/draft-changes/dependencies/dependency-closure';
import {
  ResolveCandidateDependenciesQuery,
  type ResolveCandidateDependenciesResult,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';

@QueryHandler(ResolveCandidateDependenciesQuery)
export class ResolveCandidateDependenciesHandler implements IQueryHandler<
  ResolveCandidateDependenciesQuery,
  ResolveCandidateDependenciesResult
> {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly schemaStores: JsonSchemaStoreService,
  ) {}

  async execute(
    query: ResolveCandidateDependenciesQuery,
  ): Promise<ResolveCandidateDependenciesResult> {
    return resolveDependencyClosure(
      this.queryBus,
      this.schemaStores,
      query.data,
    );
  }
}
