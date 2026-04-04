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

@Module({ imports: [EngineModule] })
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

## Data Model

```
Branch (projectId: string)
  └── Revision (head, draft, start)
        └── Table (schema: JSON Schema)
              └── Row (data: JSON, hash, meta)
```

## Documentation

- [API Reference](docs/api.md) — all `EngineApiService` methods with inputs/outputs
- [Integration Guide](docs/integration.md) — how to use in your NestJS app
- [Versioning System](docs/versioning.md) — data model, copy-on-write, commit/revert, invariants

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
| `npm run build` | Production build |

## Tech Stack

NestJS 11, TypeScript 5.9, PostgreSQL 17, Prisma 7, CQRS, Jest + SWC, ESLint 9, SonarQube

## License

[Apache-2.0](LICENSE)
