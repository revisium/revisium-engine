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

## Installation

```bash
npm install @revisium/engine
```

The default npm dist-tag is the stable release. Install an explicit prerelease
version when testing the next release line; do not use it as a stable dependency.
Check `peerDependencies` in [package.json](package.json) for the supported NestJS,
Prisma and PostgreSQL driver versions. The image dependency requires Node.js
20.9 or newer; repository development uses the version in [.nvmrc](.nvmrc).

The engine consumes [schema-toolkit](https://github.com/revisium/schema-toolkit)
and [prisma-pg-json](https://github.com/revisium/prisma-pg-json).
[revisium-core](https://github.com/revisium/revisium-core) embeds the engine in the
application assembled by [revisium](https://github.com/revisium/revisium).

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
- [Consistency and ChangeSet Contract](docs/consistency.md) — proposed ChangeSet contract; not implemented by the current runtime
- [Partial Commit Design](docs/design/partial-commit.md) — exploratory future design; no runtime API
- [File Usage Tracking](docs/file-usage.md) — dedup-aware file byte counters, reconciliation API

## Development

This project uses [pnpm](https://pnpm.io) (pinned via the `packageManager` field). Node version: see `.nvmrc`.

```bash
corepack enable
pnpm install --frozen-lockfile
docker compose -f docker/docker-compose.yml up -d
cp .env.example .env
export DATABASE_URL=postgresql://engine:password@localhost:5439/engine-dev
pnpm exec prisma db push
pnpm run prisma:generate
pnpm run start:dev
```

| Script             | Description         |
| ------------------ | ------------------- |
| `pnpm run tsc`     | Type check          |
| `pnpm run lint:ci` | ESLint (0 warnings) |
| `pnpm test`        | Run tests           |
| `pnpm run build`   | Production build    |

For the test database, full checks and package inspection, follow
[VERIFICATION.md](VERIFICATION.md). Database reset commands there are for the
isolated test database only.

## Releases

Release automation uses the immutable `revisium-actions` version pinned in
[the workflows](.github/workflows). Security fixes go through a PR to `master`,
then a manual cherry-pick to the stable branch selected from the latest published
stable release. Run the checks again on that branch before publishing a patch.
See [the release procedure](docs/releasing.md) for the dry run, publication and
artifact checks.

## Tech Stack

NestJS 11, TypeScript 5.9, PostgreSQL 17, Prisma 7, CQRS, Jest + SWC, ESLint 9, SonarQube

## License

[Apache-2.0](LICENSE)
