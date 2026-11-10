# Environment Variables

## Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://engine:password@localhost:5439/engine-dev` |

## Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `NODE_ENV` | `development` | Environment |

## Draft Changes

Limits and runtime of `EngineApiService.changes` ([API](docs/api.md#draft-changes)). The limit defaults are
conservative: raise them once the operation logs show what operations really cost. Where the defaults come from:
[partial-changes-v1 §11](docs/specs/partial-changes-v1.spec.md#11-limits-and-configuration).

| Variable | Default | Allowed | Description |
|----------|---------|---------|-------------|
| `PARTIAL_CHANGES_MAX_CHANGED_ROWS` | `20000` | 1 or more | Changed rows of the tables an operation affects (an affected table counts in full). Above it a preview, commit or revert is refused with `tooLarge` before any unit is computed. |
| `PARTIAL_CHANGES_MAX_PER_ROW_WORK` | `2000` | 1 or more | Merged or converted rows in tables whose target schema has formula or File fields. Above it the plan stops with `tooLarge`. |
| `PARTIAL_CHANGES_MAX_MIXED_TABLE_LINKS` | `100000` | 1 or more | Row links copied into one new table version of a partly applied table. Above it for any table the plan stops with `tooLarge` naming the table. |
| `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS` | `180000` | 1 to 2147453647 | Lifetime of one listing page, Draft read, preview, or commit or revert attempt; the schema ledger scan, the planning of a repair and the backfill run under it too. Past it the operation fails with `OPERATION_TIMEOUT` and is rolled back. |
| `PARTIAL_CHANGES_MAX_ATTEMPTS` | `3` | 1 or more | Serializable attempts of a commit or revert, and of the schema ledger backfill, on serialization failures. |

Each setting is read once at startup, and the effective values are logged (`Partial changes limits: …`,
`Partial operation settings: …`), with the variable each value came from when it is not the default.

## Numeric settings

A numeric variable must be a plain decimal integer within its allowed range. Any other value (`1e5`, `100_000`,
`15000ms`, `+15000`, `2000abc`, a value out of range) keeps the default and logs a startup warning; an empty value
keeps the default silently. The native transaction settings (`TRANSACTION_MAX_WAIT`, `TRANSACTION_TIMEOUT`,
`TRANSACTION_MAX_RETRIES`, `TRANSACTION_BASE_DELAY_MS`, `TRANSACTION_MAX_DELAY_MS`) follow the same rule.
