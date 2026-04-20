<div align="center">

# @revisium/engine

Git-like version control engine for structured data.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revisium-engine&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revisium-engine)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revisium-engine&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revisium-engine)
[![npm](https://img.shields.io/npm/v/@revisium/engine)](https://www.npmjs.com/package/@revisium/engine)

</div>

## What is this?

A NestJS module library that provides Git-like versioning for structured data: branches, revisions, tables, rows, JSON Schema validation, diffs, formula plugins, and migrations.

Extracted from [@revisium/core](https://github.com/revisium/revisium-core). No auth, no billing, no API controllers — pure versioning engine.

## Usage

```typescript
import { EngineModule, EngineApiService } from '@revisium/engine';

@Module({ imports: [EngineModule.forRoot()] })
export class AppModule {}

@Injectable()
export class MyService {
  constructor(private readonly engine: EngineApiService) {}

  async example() {
    await this.engine.createTable({ revisionId, tableId: 'products', schema });
    await this.engine.createRow({ revisionId, tableId, rowId, data });
    await this.engine.getRows({ revisionId, tableId, first: 100 });
    await this.engine.createRevision({ projectId, branchName, comment });
    await this.engine.revisionChanges({ revisionId });
    await this.engine.cleanOrphanedData();
  }
}
```

### With file storage

Provide your own `IStorageService` implementation (S3, local filesystem, etc.):

```typescript
import { EngineModule, IStorageService } from '@revisium/engine';

const myStorage: IStorageService = {
  isAvailable: true,
  canServeFiles: false,
  uploadFile: (file, path) => s3Client.upload(file, path),
  getPublicUrl: (key) => `https://cdn.example.com/${key}`,
};

@Module({ imports: [EngineModule.forRoot({ storage: myStorage })] })
export class AppModule {}
```

Without a storage provider, file operations throw "Storage is not configured".

### File usage tracking

When file storage is configured, the engine tracks reference-counted file-byte totals per project. `projectId` is treated as an opaque string — the engine does not model organizations or project lifecycle. Consumers pass project identifiers when they want file-usage information:

```typescript
const bytes = await engine.getProjectStorageBytes({ projectId: 'games' });
const orgBytes = await engine.getStorageBytesForProjects({
  projectIds: ['games', 'art', 'music'],
});
```

Reconciliation API for audits and legacy-data migration:

```typescript
await engine.validateProjectFileBytes({ projectId: 'games' });
await engine.restoreProjectFileBytes({ projectId: 'games' });
await engine.backfillProjectFileBlobs({ projectId: 'games', dryRun: true });
```

Cleanup uses a tombstone + confirm pattern. `cleanupOrphanedFileBlobs` / `cleanupProjectFileUsage` tombstone rows (set `deletedAt`) and return `orphanHashes` — the content hashes whose last active row was just tombstoned. The engine never calls the storage provider; the consumer deletes the underlying objects and then confirms back so the tombstone rows are hard-deleted:

```typescript
const { orphanHashes } = await engine.cleanupOrphanedFileBlobs();

const confirmed: string[] = [];
for (const hash of orphanHashes) {
  try {
    await myStorage.deleteFile(hash);
    confirmed.push(hash);
  } catch (error) {
    // leave tombstoned; getPendingStorageDeletions will surface it for retry
  }
}
if (confirmed.length > 0) {
  await engine.confirmStorageDeleted({ hashes: confirmed });
}

// Periodic reconcile pass for storage deletions that failed earlier:
const pending = await engine.getPendingStorageDeletions({ limit: 500 });

// Consumer-hard-deleted project:
await engine.cleanupProjectFileUsage({ projectId: 'games' });

// Forking a project: backfill the new projectId so it gets its own FileBlob rows
await engine.backfillProjectFileBlobs({ projectId: 'games-fork' });
```

See [File Usage Tracking](docs/file-usage.md) for the full data model, write rules, scenario table, and storage-side deletion workflow.

## Data Model

```
Branch (projectId: string, opaque)
  └── Revision (head, draft, start)
        └── Table (schema: JSON Schema)
              └── Row (data: JSON, hash, meta)
                    └── FileBlob (via _FileBlobToRow M2M, unique per projectId+hash)

ProjectFileUsage (per-project byte counter, keyed by opaque projectId)
```

## Documentation

- [API Reference](docs/api.md) — all `EngineApiService` methods with inputs/outputs
- [Integration Guide](docs/integration.md) — how to use in your NestJS app
- [Versioning System](docs/versioning.md) — data model, copy-on-write, commit/revert, invariants
- [File Usage Tracking](docs/file-usage.md) — dedup-aware file byte counters, reconciliation API

## Development

```bash
npm ci
docker compose -f docker/docker-compose.yml up -d
cp .env.example .env
npm run prisma:generate
npm run start:dev
```

| Script            | Description             |
| ----------------- | ----------------------- |
| `npm run tsc`     | Type check              |
| `npm run lint:ci` | ESLint (0 warnings)     |
| `npm test`        | Run tests (1100+ tests) |
| `npm run build`   | Production build        |

## Tech Stack

NestJS 11, TypeScript 5.9, PostgreSQL 17, Prisma 7, CQRS, Jest + SWC, ESLint 9, SonarQube

## License

[Apache-2.0](LICENSE)
