# Consumer Integration Guide

This document explains how to integrate `@revisium/engine` into a host application (like `@revisium/core`) and add the layers that the engine intentionally omits.

## Importing the Engine

### Option A: Import AppModule (all modules at once)

```typescript
import { AppModule as EngineModule } from '@revisium/engine';

@Module({
  imports: [EngineModule],
})
export class CoreModule {}
```

### Option B: Import individual modules

```typescript
import {
  DatabaseModule,
  ShareModule,
  PluginModule,
  StorageModule,
  RevisionModule,
  BranchModule,
  TableModule,
  RowModule,
  DraftRevisionModule,
  DraftModule,
  RevisionChangesModule,
  SubSchemaModule,
  ViewsModule,
} from '@revisium/engine';
```

## Adding Cache

The engine performs no caching. To add cache, wrap the engine's `*ApiService` classes.

```typescript
@Injectable()
export class CachedRowApiService {
  constructor(
    private readonly rowApi: RowApiService,
    private readonly cache: CacheService,
  ) {}

  getRow(data: GetRowQueryData) {
    const key = `row:${data.revisionId}:${data.tableId}:${data.rowId}`;
    return this.cache.getOrSet(key, () => this.rowApi.getRow(data));
  }

  getRows(data: GetRowsQueryData) {
    return this.cache.getOrSet(
      `rows:${data.revisionId}:${data.tableId}:${JSON.stringify(data)}`,
      () => this.rowApi.getRows(data),
    );
  }
}
```

Cache invalidation: subscribe to revision commits and revert operations to clear relevant cache entries.

## Adding Billing Limits

The engine does not enforce any limits. To add billing/limit checks, wrap `DraftApiService` mutations.

```typescript
@Injectable()
export class LimitedDraftApiService {
  constructor(
    private readonly draftApi: DraftApiService,
    private readonly limits: ILimitsService,
  ) {}

  async apiCreateRow(data: ApiCreateRowCommandData) {
    await this.limits.check('ROW_VERSIONS', data.revisionId);
    return this.draftApi.apiCreateRow(data);
  }

  async apiUploadFile(data: ApiUploadFileCommandData) {
    await this.limits.check('STORAGE_BYTES', data.revisionId);
    return this.draftApi.apiUploadFile(data);
  }
}
```

## Adding Events / Notifications

The engine does not emit events. To add event-driven behavior (e.g. cache invalidation, endpoint notifications, webhooks), wrap service calls.

```typescript
@Injectable()
export class EventEmittingDraftApiService {
  constructor(
    private readonly draftApi: DraftApiService,
    private readonly eventBus: EventBus,
  ) {}

  async apiCreateRevision(data: ApiCreateRevisionCommandData) {
    const result = await this.draftApi.apiCreateRevision(data);

    this.eventBus.publish(new RevisionCommittedEvent({
      revisionId: result.id,
      branchId: data.branchId,
    }));

    return result;
  }

  async apiCreateRow(data: ApiCreateRowCommandData) {
    const result = await this.draftApi.apiCreateRow(data);

    this.eventBus.publish(new RowCreatedEvent({
      revisionId: data.revisionId,
      tableId: data.tableId,
      rowId: result.row.id,
    }));

    return result;
  }
}
```

## Adding Auth / Permissions

The engine has no auth layer. Add guards and permission checks at the API controller level.

```typescript
@UseGuards(JwtAuthGuard, CaslGuard)
@Resolver()
export class DraftResolver {
  constructor(private readonly draftApi: DraftApiService) {}

  @Mutation()
  @CheckPolicies((ability) => ability.can('update', 'Draft'))
  async createRow(@Args() args: CreateRowArgs, @CurrentUser() user: User) {
    return this.draftApi.apiCreateRow({
      revisionId: args.revisionId,
      tableId: args.tableId,
      rowId: args.rowId,
      data: args.data,
    });
  }
}
```

## PrismaClient Injection

At runtime, the consumer provides the full `PrismaClient` (with all models including `Project`, `Organization`, `User`, etc.) via NestJS DI. The engine uses only the `Branch`, `Revision`, `Table`, and `Row` models.

The engine's own Prisma schema (4 models, no FKs to Project) exists solely for running the engine's test suite in CI.

## Storage Service Override

The engine includes `StorageModule` with S3, Local, and Null implementations. To override:

```typescript
@Module({
  imports: [StorageModule],
})
export class AppModule {}

// Or override the provider:
Test.createTestingModule({
  imports: [StorageModule],
})
  .overrideProvider(STORAGE_SERVICE)
  .useValue(myCustomStorage)
  .compile();
```

## Cleanup (Orphaned Data)

The engine's copy-on-write model creates orphaned tables and rows (disconnected from all revisions). The engine exposes `CleanupService.cleanOrphanedData()` — call it from your own cron:

```typescript
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CleanupService } from '@revisium/engine';

@Injectable()
export class AppCleanupService {
  constructor(private readonly cleanup: CleanupService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run() {
    const { tables, rows } = await this.cleanup.cleanOrphanedData();
    // tables/rows deleted counts available for logging
  }
}
```

## What the Engine Provides vs What the Consumer Adds

| Layer | Engine | Consumer |
|-------|--------|----------|
| Data model | Branch, Revision, Table, Row | Project, Organization, User, Role, Endpoint |
| Mutations | Create/update/delete/rename rows, tables; commit; revert; migrations | Billing limit enforcement, event emission |
| Queries | Get rows/tables/revisions, search, diffs, foreign keys | Caching, auth-scoped queries |
| Schema | JSON Schema validation, plugins, formula evaluation | API schema (GraphQL/REST/MCP) |
| Storage | S3/Local/Null file storage | Storage config, CDN |
| Auth | None | JWT, OAuth, CASL, guards |
| Notifications | None | Endpoint notification, webhooks |
| Cache | None | BentoCache, Redis, in-memory |
