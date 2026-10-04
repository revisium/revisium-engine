# Revisium engine instructions

At the beginning of a task, resolve the default branch of
[revisium/agent-rules](https://github.com/revisium/agent-rules) to a commit SHA
once. Read its `AGENTS.md` and only the applicable topic files at that SHA.
Record the selected SHA in the handoff. Follow local overrides and explicit
user instructions before shared defaults.

This repository owns the NestJS versioning library, not authentication, billing
or API controllers. Preserve the public engine API and consumer compatibility.
Use [README.md](README.md) and [docs/integration.md](docs/integration.md) for
integration boundaries; load [VERIFICATION.md](VERIFICATION.md) before changes
or verification and [docs/releasing.md](docs/releasing.md) for release work.

Use the checked-out branch's manifest, lockfile and `.nvmrc`: master uses pnpm;
existing stable branches may still use npm. Do not migrate a stable branch's
package manager as part of a security backport. Master's `0.0.0` package version
is a release-train placeholder.

Keep the cloud knowledge-base reference in [CLAUDE.md](CLAUDE.md); it supplements
repository documentation when that provider is available.
