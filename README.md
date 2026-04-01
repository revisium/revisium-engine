<div align="center">

# @revisium/engine

Revisium version engine — core versioning logic for branches, revisions, tables, and rows.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revisium-engine&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revisium-engine)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revisium-engine&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revisium-engine)
[![npm](https://img.shields.io/npm/v/@revisium/engine)](https://www.npmjs.com/package/@revisium/engine)

</div>

## Quick Start

```bash
# install dependencies
npm ci

# start dev database
docker compose -f docker/docker-compose.yml up -d

# copy env
cp .env.example .env

# generate prisma client
npm run prisma:generate

# run migrations
npm run prisma:migrate:dev

# start in dev mode
npm run start:dev
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Start in watch mode |
| `npm run build` | Build for production |
| `npm run lint:ci` | Lint (0 warnings) |
| `npm run tsc` | Type check |
| `npm test` | Run tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run prisma:migrate:dev` | Create migration |
| `npm run prisma:migrate:deploy` | Apply migrations |

## Tech Stack

- **Runtime**: Node.js 24, TypeScript 5.9
- **Framework**: NestJS 11, CQRS
- **Database**: PostgreSQL 17, Prisma 7
- **Testing**: Jest + SWC
- **Code Quality**: ESLint 9, Prettier, SonarQube

## Environment Variables

See [ENV.md](ENV.md) for the full reference.

## License

[Apache-2.0](LICENSE)
