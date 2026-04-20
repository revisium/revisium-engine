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

If you prefer module-level composition instead of the unified facade, `FileUsageModule` and `FileUsageApiService` are also exported from `@revisium/engine`.

### With async migration config

```typescript
@Module({
  imports: [
    EngineModule.forRoot({
      migration: {
        threshold: 5000,      // rows before async kicks in (default: 1000)
        batchSize: 2000,      // rows per batch (default: 1000)
        workerMode: 'inline', // 'inline' | 'polling' | 'disabled'
      },
    }),
  ],
})
export class CoreModule {}
```

See [migration.md](migration.md) for full migration system documentation.

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
  FileUsageModule,
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

## File Usage Tracking

The engine tracks file-reference bytes per project with content-hash deduplication. No consumer setup is required — the integration runs automatically inside every row mutation. Consumers only have to:

1. Read counters when they want usage numbers.
2. Delete storage objects after the engine tells them which hashes went orphan, and confirm back to the engine.
3. Call one method when a project is hard-deleted on the consumer side.
4. Call one method after forking a project so the new `projectId` gets its own blob rows.

See [file-usage.md](file-usage.md) for the full data model, tombstone lifecycle, and scenarios.

### Automatic lifecycle (handled by the engine)

| Event                                                             | Engine behavior                                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Row created with an uploaded file field                           | UPSERTs `FileBlob`, inserts `_FileBlobToRow` link, increments `ProjectFileUsage.fileBytes`                               |
| Row created/updated with a hash that currently has a tombstone    | Clears `deletedAt` (reactivates), re-links M2M, increments counter                                                       |
| Row updated / renamed (copy-on-write new version)                 | Registers refs for the new Row version; old version's links stay until it is hard-deleted                                |
| Row removed (`removeRow` / `removeRows`)                          | Pre-query the blob ids linked to those rowIds; after the hard-delete, tombstone only those blobs whose last M2M link just vanished and decrement the counter in the same request |
| File uploaded (`uploadFile` step 2)                               | Flows through the row-update path — no extra call needed                                                                 |
| `cleanOrphanedData` runs                                          | Row/table hard-delete → `_FileBlobToRow` cascade-deletes → sweep **tombstones** orphan `FileBlob` rows, decrements counters |
| Draft `revert`                                                    | No real-time hook — draft-only row versions become revision-unreachable but are not hard-deleted. Counter catches up via the next `cleanOrphanedData`. Run the drift cron to monitor |

### Consumer responsibilities

**Storage-side deletion, two-phase.** Cleanup operations return `orphanHashes` — hashes whose last *active* `FileBlob` row was just tombstoned. The engine never touches `IStorageService`. The consumer deletes the objects and then confirms back so the engine can hard-delete the tombstone rows:

```typescript
import { Cron, CronExpression } from '@nestjs/schedule';
import { CleanupService, EngineApiService } from '@revisium/engine';

@Injectable()
export class AppCleanupService {
  constructor(
    private readonly cleanup: CleanupService,
    private readonly engine: EngineApiService,
    private readonly storage: MyStorageService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep() {
    const { orphanHashes } = await this.cleanup.cleanOrphanedData();
    await this.deleteAndConfirm(orphanHashes);
  }

  // Second pass: retry any storage deletions that failed previously.
  // Tombstones remain visible via getPendingStorageDeletions until confirmed.
  @Cron(CronExpression.EVERY_HOUR)
  async reconcileStorage() {
    const pending = await this.engine.getPendingStorageDeletions({ limit: 500 });
    await this.deleteAndConfirm(pending.map((p) => p.hash));
  }

  private async deleteAndConfirm(hashes: readonly string[]) {
    const confirmed: string[] = [];
    for (const hash of hashes) {
      try {
        await this.storage.deleteFile(hash);
        confirmed.push(hash);
      } catch (error) {
        this.logger.warn(`Storage delete failed for ${hash}; will retry`, error);
      }
    }
    if (confirmed.length > 0) {
      await this.engine.confirmStorageDeleted({ hashes: confirmed });
    }
  }
}
```

Retry semantics: until `confirmStorageDeleted` is called, the tombstone row stays — so `getPendingStorageDeletions` surfaces it again and the hourly pass keeps retrying. A re-upload of the same hash (e.g. the user restores content) reactivates the tombstone and removes it from the pending list automatically.

For large backlogs, checkpoint on `afterHash` instead of always starting from the beginning:

```typescript
let afterHash: string | undefined;

for (;;) {
  const batch = await this.engine.getPendingStorageDeletions({
    limit: 500,
    afterHash,
  });
  if (batch.length === 0) {
    break;
  }

  await this.deleteAndConfirm(batch.map((item) => item.hash));
  afterHash = batch[batch.length - 1]?.hash;
}
```

**Project deletion.** When the consumer hard-deletes a project, it must call `cleanupProjectFileUsage` so the engine tombstones all `FileBlob` rows and drops the counter for that `projectId`:

```typescript
async deleteProject(projectId: string) {
  // 1. Cascade-delete consumer-owned data (rows, branches, whatever the consumer owns)
  await this.myProjectService.deleteProjectData(projectId);

  // 2. Tell the engine to tombstone its file-usage tracking for this project
  const { orphanHashes } = await this.engine.cleanupProjectFileUsage({
    projectId,
  });

  // 3. Delete storage objects and confirm. The reconcileStorage cron above
  //    will retry anything that fails here.
  const confirmed: string[] = [];
  for (const hash of orphanHashes) {
    try {
      await this.storage.deleteFile(hash);
      confirmed.push(hash);
    } catch (error) {
      this.logger.warn(`Storage delete failed for ${hash}`, error);
    }
  }
  if (confirmed.length > 0) {
    await this.engine.confirmStorageDeleted({ hashes: confirmed });
  }
}
```

**Fork.** When the consumer forks a project (new `projectId` reusing rows from an existing `revisionId`), call `backfillProjectFileBlobs` on the new project so its `FileBlob` rows and counter are populated:

```typescript
async forkProject(sourceRevisionId: string): Promise<string> {
  const newProjectId = await this.myProjectService.fork(sourceRevisionId);
  await this.engine.backfillProjectFileBlobs({ projectId: newProjectId });
  return newProjectId;
}
```

**Reading usage.** Any time, no side effects:

```typescript
const projectBytes = await this.engine.getProjectStorageBytes({ projectId });

// Org / team aggregation — consumer supplies the grouping
const orgBytes = await this.engine.getStorageBytesForProjects({
  projectIds: await this.myOrgService.listProjectIds(organizationId),
});
```

### Reconciliation

`ProjectFileUsage.fileBytes` is a denormalized counter. In normal operation it matches `SUM(FileBlob.size)` exactly. If drift is suspected (incident recovery, manual DB edit, interrupted cleanup), validate and restore:

```typescript
const report = await this.engine.validateProjectFileBytes({ projectId });
if (report.drift !== 0n) {
  this.alert(`File-byte drift for project ${projectId}: ${report.drift}`);
  await this.engine.restoreProjectFileBytes({ projectId });
}
```

`validate` is read-only and cheap. A daily cron that validates every active project and pages on non-zero drift catches most problems without taking action:

```typescript
@Cron(CronExpression.EVERY_DAY_AT_3AM)
async validateAllProjects() {
  const projectIds = await this.myProjectService.listProjectIds();
  for (const projectId of projectIds) {
    const report = await this.engine.validateProjectFileBytes({ projectId });
    if (report.drift !== 0n) {
      this.alert('file-usage drift', report);
    }
  }
}
```

### Backfill (legacy data migration)

Projects that predate file-usage tracking have rows with file metadata but no `FileBlob` rows. Run the backfill once per project to populate `FileBlob` + `_FileBlobToRow` + `ProjectFileUsage` from existing row data:

```typescript
// Preview first
const preview = await this.engine.backfillProjectFileBlobs({
  projectId,
  dryRun: true,
});
this.logger.log(`Would create ${preview.blobsCreated} blobs, ${preview.fileBytesAfter} bytes`);

// Apply
const applied = await this.engine.backfillProjectFileBlobs({ projectId });
```

Backfill is idempotent. Running it against an already-populated project is safe and costs only the scan.

## Cleanup (Orphaned Data)

The engine's copy-on-write model creates orphaned tables and rows (disconnected from all revisions). `CleanupService.cleanOrphanedData()` deletes them — and, as shown in the file-usage section above, reports any hashes that fell out of use so the consumer can delete them from storage.

```typescript
const { tables, rows, fileBlobsTombstoned, fileBytesFreed, orphanHashes } =
  await this.cleanup.cleanOrphanedData();
```

Call from a cron (see the file-usage example above for a full one).

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
