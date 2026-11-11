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
| `PARTIAL_CHANGES_MAX_LISTED_DETAILS` | `200` | 1 or more | Entries of `required` and, separately, of `blockers` that a preview, commit or revert result lists; `requiredTotal` and `blockersTotal` count them all. It bounds the size of a result and changes nothing else: `includeRequired` applies every required addition. |
| `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS` | `180000` | 1 to 2147453647 | Lifetime of one listing page, Draft read, preview, or commit or revert attempt; it also bounds the Head and Draft read of each branch in the schema ledger scan, the planning of a repair, and the backfill. Past it the operation fails with `OPERATION_TIMEOUT` and is rolled back. |
| `PARTIAL_CHANGES_MAX_ATTEMPTS` | `3` | 1 or more | Serializable attempts of a commit or revert, and of the schema ledger backfill, on serialization failures. |

Each setting is read once at startup, and the effective values are logged (`Partial changes limits: …`,
`Partial operation settings: …`), with the variable each value came from when it is not the default.

Each listing page, Draft read, preview, commit and revert, and each schema ledger backfill and repair, logs one
structured entry through the NestJS logger with the context `OperationLog` (messages `Partial changes operation
finished` and `Schema ledger operation finished`): duration, outcome, attempts and counts, never row data
([partial-changes-v1 §11.1](docs/specs/partial-changes-v1.spec.md#111-operation-logs)). These are the entries to read
before raising a limit.

Draft changes also follow three of the transaction settings below: `TRANSACTION_MAX_WAIT` bounds the wait to start
each transaction, the retry backoff of a commit or revert uses `TRANSACTION_BASE_DELAY_MS` and
`TRANSACTION_MAX_DELAY_MS`, and a commit or revert waits at most half of `TRANSACTION_TIMEOUT` for the branch write
fence (then `BRANCH_WRITE_FENCED`). `TRANSACTION_MAX_RETRIES` does not apply to them.

## Transactions

Native writes run in Serializable transactions with these settings.

| Variable | Default | Allowed | Description |
|----------|---------|---------|-------------|
| `TRANSACTION_MAX_WAIT` | `10000` | 1 or more | Milliseconds to wait for a connection to start a transaction. |
| `TRANSACTION_TIMEOUT` | `15000` | 1 or more | Milliseconds a native transaction may run. Writers wait at most half of it for the branch write fence. |
| `TRANSACTION_MAX_RETRIES` | `20` | 0 or more | Attempts of a native Serializable write on serialization failures. `0` is accepted but leaves row and table writes no attempt, so they fail; use 1 or more. |
| `TRANSACTION_BASE_DELAY_MS` | `30` | 0 or more | Milliseconds of the first delay of the exponential backoff between attempts. |
| `TRANSACTION_MAX_DELAY_MS` | `1500` | 0 or more | Cap of the backoff delay in milliseconds; a random jitter of up to half the delay is added on top. |

The effective values are logged at startup (`Transaction settings: …`).

## Numeric settings

A numeric variable must be a plain decimal integer within its allowed range. Any other value (`1e5`, `100_000`,
`15000ms`, `+15000`, `2000abc`, a value out of range) keeps the default and logs a startup warning; an empty value
keeps the default silently. Every variable of the Draft changes and transaction tables follows this rule.
