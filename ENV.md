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

## Partial changes

Limits and transaction settings of `EngineApiService.changes`
([partial-changes-v1 §11](docs/specs/partial-changes-v1.spec.md#11-limits-and-configuration)). The defaults are
provisional until they are re-measured for the release gate. A value that is not a number, or is below 1, falls back
to the default with a warning.

| Variable | Default | Description |
|----------|---------|-------------|
| `PARTIAL_CHANGES_MAX_CHANGED_ROWS` | `100000` | Changed rows of the tables a preview, commit or revert reads; above it the plan is `blocked` with `tooLarge` |
| `PARTIAL_CHANGES_MAX_PER_ROW_WORK` | `10000` | Merged or converted rows in mixed tables whose target schema has formula or File fields; above it → `tooLarge` |
| `PARTIAL_CHANGES_MAX_MIXED_TABLE_LINKS` | `250000` | Row links copied into one new table version; above it for any table → `tooLarge` with that `tableId` |
| `PARTIAL_CHANGES_OPERATION_TIMEOUT_MS` | `180000` | Lifetime of one listing page, one preview, or one commit or revert attempt; expired → `OPERATION_TIMEOUT` and a rollback |
| `PARTIAL_CHANGES_MAX_ATTEMPTS` | `3` | Serializable attempts of one commit or revert; exhausted → the last serialization failure |
