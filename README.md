<div align="center">

# @revisium/engine

Git-like version control engine for structured data.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revisium-engine&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revisium-engine)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revisium-engine&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revisium-engine)
[![npm](https://img.shields.io/npm/v/@revisium/engine)](https://www.npmjs.com/package/@revisium/engine)

</div>

## What is this?

The versioning engine extracted from [@revisium/core](https://github.com/revisium/revisium-core). It handles branches, revisions, tables, rows, JSON Schema validation, diffs, plugins (formula, file, system columns), and migrations — without any application-layer concerns (auth, billing, API controllers, endpoint generation).

The engine is a **NestJS module library**. The consumer (e.g. `@revisium/core`) provides `PrismaClient` via DI and adds its own cache, billing limits, notifications, and API layers on top.

## Architecture

```
Branch (projectId: string, no FK)
  └── Revision (head, draft, start)
        └── Table (schema: JSON Schema)
              └── Row (data: JSON, hash, meta)
```

**Modules:**

| Module | Purpose |
|--------|---------|
| `ShareModule` | Diff, schema validation, foreign keys, JSON Schema store, system tables |
| `PluginModule` | 10 plugins: formula, file, row-id, row-hash, row-created-at, etc. |
| `StorageModule` | S3 / Local / Null file storage |
| `RevisionModule` | Revision queries (get, migrations, parent/child traversal) |
| `BranchModule` | Branch CRUD, revision history |
| `TableModule` | Table queries, schema resolution, foreign key resolution |
| `RowModule` | Row queries, full-text search, keyset pagination |
| `DraftRevisionModule` | Low-level draft operations (create/update/delete/rename rows and tables, commit, revert) |
| `DraftModule` | High-level draft API with validation, schema management, migrations |
| `RevisionChangesModule` | Diff computation between revisions (table diffs, row diffs, schema impact) |
| `SubSchemaModule` | Sub-schema introspection and query |
| `ViewsModule` | Table views (columns, filters, sorts) |

## Usage

### Import and inject

```typescript
import { Module, Injectable } from '@nestjs/common';
import { EngineModule, EngineApiService } from '@revisium/engine';

@Module({
  imports: [EngineModule],
})
export class CoreModule {}

@Injectable()
export class MyService {
  constructor(private readonly engine: EngineApiService) {}

  async example() {
    // Tables
    await this.engine.createTable({ revisionId, tableId: 'products', schema });
    await this.engine.getTables({ revisionId, first: 10 });

    // Rows
    await this.engine.createRow({ revisionId, tableId, rowId, data });
    await this.engine.getRows({ revisionId, tableId, first: 100 });
    await this.engine.searchRows({ revisionId, query: 'keyword' });

    // Commit
    await this.engine.createRevision({ projectId, branchName, comment });

    // Diff
    await this.engine.revisionChanges({ revisionId });

    // Cleanup
    await this.engine.cleanOrphanedData();
  }
}
```

### Or import individual modules

```typescript
import {
  DraftModule,
  RevisionModule,
  RowModule,
  DraftApiService,
} from '@revisium/engine';
```

See [docs/api.md](docs/api.md) for the full API reference.

## Consumer Extension Points

The engine is intentionally minimal. Consumers add their own layers for:

| Concern | What engine does | What consumer adds |
|---------|-----------------|-------------------|
| **Cache** | No caching — all queries go to DB | Wrap `*ApiService` methods with cache (e.g. BentoCache) |
| **Billing/Limits** | No limit checks | Check limits before calling `DraftApiService` mutations |
| **Events/Notifications** | No events emitted | Listen to DB changes or wrap service calls with EventBus |
| **Endpoint Notifications** | No endpoint awareness | Subscribe to revision commits, notify endpoints |
| **Cleanup** | `CleanupService.cleanOrphanedData()` exposed | Call from your own `@Cron` |
| **Auth/Permissions** | No auth layer | Add guards at API layer, inject user context |

See [docs/integration.md](docs/integration.md) for detailed examples and [docs/versioning.md](docs/versioning.md) for the versioning system specification.

## Development

```bash
npm ci
docker compose -f docker/docker-compose.yml up -d
cp .env.example .env
npm run prisma:generate
npm run start:dev
```

| Script | Description |
|--------|-------------|
| `npm run tsc` | Type check |
| `npm run lint:ci` | ESLint (0 warnings) |
| `npm test` | Run tests (1100+ tests) |
| `npm run test:cov` | Tests with coverage |
| `npm run build` | Production build |

## Prisma Strategy

The engine has a **test-only** Prisma schema with 4 models: `Branch`, `Revision`, `Table`, `Row`. `Branch.projectId` is a plain `String` (no FK to Project).

At runtime, the consumer provides its full `PrismaClient` via NestJS DI — the engine's own schema is never used in production.

## Tech Stack

- **Runtime**: Node.js 24, TypeScript 5.9
- **Framework**: NestJS 11, CQRS
- **Database**: PostgreSQL 17, Prisma 7
- **Schema**: JSON Schema validation via `@revisium/schema-toolkit`
- **Testing**: Jest + SWC (1100+ tests)
- **Code Quality**: ESLint 9, Prettier, SonarQube

## License

[Apache-2.0](LICENSE)
