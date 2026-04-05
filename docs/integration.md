# Consumer Integration Guide

This document explains how to integrate `@revisium/engine` into a host application (like `@revisium/core`) and add the layers that the engine intentionally omits.

## Importing the Engine

### Recommended: Use EngineApiService

```typescript
import { EngineModule, EngineApiService } from '@revisium/engine';

@Module({
  imports: [EngineModule.forRoot()],
})
export class CoreModule {}

@Injectable()
export class MyService {
  constructor(private readonly engine: EngineApiService) {}
}
```

`EngineApiService` is a flat facade over all engine services. See [api.md](api.md) for the full method reference.

### With file storage

The engine accepts an `IStorageService` implementation via `forRoot()`. Without it, file operations (uploadFile, file plugin) are disabled.

```typescript
import { EngineModule, IStorageService } from '@revisium/engine';

const s3Storage: IStorageService = {
  isAvailable: true,
  canServeFiles: false,
  async uploadFile(file, path) {
    /* your S3/GCS/Azure logic */
    return { key: path };
  },
  getPublicUrl(key) {
    return `https://cdn.example.com/${key}`;
  },
};

@Module({
  imports: [EngineModule.forRoot({ storage: s3Storage })],
})
export class CoreModule {}
```

### Alternative: Import individual modules

```typescript
import {
  DatabaseModule,
  ShareModule,
  PluginModule,
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

    this.eventBus.publish(
      new RevisionCommittedEvent({
        revisionId: result.id,
        branchId: data.branchId,
      }),
    );

    return result;
  }

  async apiCreateRow(data: ApiCreateRowCommandData) {
    const result = await this.draftApi.apiCreateRow(data);

    this.eventBus.publish(
      new RowCreatedEvent({
        revisionId: data.revisionId,
        tableId: data.tableId,
        rowId: result.row.id,
      }),
    );

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

## Storage

The engine does not include storage implementations (no S3, no local filesystem). Instead, it accepts an `IStorageService` via `EngineModule.forRoot({ storage })`.

The `IStorageService` interface:

```typescript
interface IStorageService {
  readonly isAvailable: boolean;
  readonly canServeFiles: boolean;
  uploadFile(file: Express.Multer.File, path: string): Promise<{ key: string }>;
  getPublicUrl(key: string): string;
}
```

If no storage is provided, the engine uses `NullStorageService` (throws on upload, returns empty URLs).

In tests, override the storage token:

```typescript
import { STORAGE_SERVICE } from '@revisium/engine';

Test.createTestingModule({
  imports: [EngineModule.forRoot()],
})
  .overrideProvider(STORAGE_SERVICE)
  .useValue(mockStorage)
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

| Layer         | Engine                                                               | Consumer                                    |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| Data model    | Branch, Revision, Table, Row                                         | Project, Organization, User, Role, Endpoint |
| Mutations     | Create/update/delete/rename rows, tables; commit; revert; migrations | Billing limit enforcement, event emission   |
| Queries       | Get rows/tables/revisions, search, diffs, foreign keys               | Caching, auth-scoped queries                |
| Schema        | JSON Schema validation, plugins, formula evaluation                  | API schema (GraphQL/REST/MCP)               |
| Storage       | IStorageService interface, NullStorageService default                | S3/Local/custom implementation, CDN         |
| Auth          | None                                                                 | JWT, OAuth, CASL, guards                    |
| Notifications | None                                                                 | Endpoint notification, webhooks             |
| Cache         | None                                                                 | BentoCache, Redis, in-memory                |
