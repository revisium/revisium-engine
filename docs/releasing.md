# Release procedure

Determine the stable line from the latest non-prerelease GitHub Release and npm
`latest`. Match its tag to `release/<major>.<minor>.x` and record the branch SHA.
Do not select the stable branch from master's development version or an alpha tag.

1. Prepare security fixes and release configuration changes in a PR to `master`.
   Complete [verification](../VERIFICATION.md) and record the tested SHA.
2. After merge, manually cherry-pick the required final commits to the current
   stable branch, without a backport PR. Include any required existing release
   migration separately. Do not merge all of master into a stable patch.
3. Keep the stable branch's package manager and lockfile. The shared release train
   supports npm and pnpm; adapt `package_manager`, install, generation and
   validation commands together. Verify CI covers pushes to `release/**`.
4. Run the full gate again on the stable branch and record its new SHA. Resolve
   conflicts without importing unrelated development. Audit its actual lockfile.
5. Dispatch Release Train on that stable branch with `action=patch` and
   `dry_run=true`. Inspect the computed version, changed manifest/lockfile and
   tag source before a real run. Org release-bot credentials must be available.
6. Recheck that the calculated version and tag are unused, then dispatch the same
   transition with `dry_run=false`. The tag triggers the npm publisher using
   the pinned shared workflow and the branch's generation/build commands.
7. Confirm the tag and published package come from the tested release commit.
   Check npm version, `latest` dist-tag, integrity and package contents, the
   publisher run and GitHub Release. Replace generic installation-only release
   text with actual fixes, compatibility changes and remaining limitations.
8. Record the PR, merge SHA, cherry-pick SHAs, checks, release links and exact
   package version in the `revisium-operations` task log before updating core.

If publication is partial, inspect GitHub and npm before rerunning. A published
npm version is immutable: recover the missing step rather than reusing that
version for different contents. Keep alpha/RC releases on their own dist-tags.

## Current branch tooling

Master uses pnpm and the shared release train. The existing `release/0.7.x`
line uses npm; its legacy workflows need the shared-workflow migration before
this procedure can be used there. Selectively backport the migration, adapt its
commands to npm and verify the dry run. Do not copy master's pnpm conversion.
Keep the stable package and lockfile version at its actual published version;
the migration's master-only change to `0.0.0` must not be carried into stable.

The shared workflow version is owned by the caller configuration under
`.github/workflows`; keep it pinned to an immutable commit. Master's `0.0.0`
package version is intentional and is replaced by the release train.

## Dependency compatibility and remaining findings

schema-toolkit 0.24.2 quotes property names in its PostgreSQL JSONPath output.
View validation and ref discovery use the toolkit's schema-path-to-logical-path conversion instead
of DB paths, preserving the existing `data.name` and nested view-field syntax.
Verify ordinary and hyphenated fields, including array descendants, on backport.

The security refresh updates sharp from 0.34 to 0.35. Its Node minimum is 20.9;
image inputs now have sharp's default five-channel limit. The engine reads
metadata only and does not use the removed deprecated sharp options. Validate
file uploads with the existing file-plugin and engine integration tests.

`pnpm-workspace.yaml` temporarily overrides three upstream exact dependencies:
SonarJS minimatch to 10.2.3, Prisma mysql2 to 3.23.1 and Prisma config deepmerge-ts
to 8.0.0. Remove each override once its owning package selects a fixed version
without it, then regenerate the lockfile and repeat verification. The deepmerge
major changes Map merging and mutation semantics; Prisma config uses `deepmerge`
for this repository's ordinary configuration objects. Verify config loading,
client/SQL generation and database operations with the override in place.

These pins affect this repository's tooling installation. They do not secure a
consumer's independently installed Prisma peers; audit downstream lockfiles too.
For an npm backport, translate only the applicable pins to npm's scoped overrides
and verify the resulting package-lock.json rather than copying pnpm settings.

The dev-only Jest micromatch chain still includes braces 3.0.3. As checked on
2026-10-04, the registry has no braces 3.0.4 despite npm audit suggesting it; the
[reviewed advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists no
patched version. Keep this finding visible and do not claim a clean full audit.
Do not feed untrusted patterns to the test runner. Recheck upstream availability
and the actual release lockfile before deciding whether a patch can be published.
