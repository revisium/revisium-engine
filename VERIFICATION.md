# Verification

Use Node from `.nvmrc` and the package manager declared on the checked-out branch.
For master:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run docker:test-container-up
export DATABASE_URL=postgresql://engine:password@localhost:5440/engine-test
pnpm exec prisma db push --force-reset --accept-data-loss
pnpm exec prisma generate --sql
pnpm run prisma:postgenerate
pnpm run lint:ci
pnpm run tsc
pnpm run build
pnpm run test:ci
pnpm audit --json
npm pack --dry-run --ignore-scripts
pnpm run docker:test-container-down
```

The database reset destroys data. Use only the dedicated test database above or
an isolated sandbox database; never point it at a development or production DB.
Always stop the test container, including when a check fails. An isolated runtime
may supply `DATABASE_URL` and PostgreSQL instead of the Docker Compose commands.

Check the package file list against `package.json`: built public entry points,
types and Prisma schema/SQL must be present; test fixtures, credentials and local
configuration must be absent. Do not publish from `npm pack --dry-run`.

For npm-based stable branches, use `npm ci`, `npm run` and `npx --no-install`
instead of pnpm. Generate Prisma and run the same lint, type, build, test and
package checks. Use `npm audit --json` for their package-lock.json. Do not compare
npm vulnerable-package counts with pnpm advisory counts as the same metric.

Run `actionlint` when available after GitHub Actions changes. Report audit
findings, skipped tests and unavailable checks explicitly. Existing CI Sonar
analysis remains enabled; local checks do not substitute for its hosted result.
