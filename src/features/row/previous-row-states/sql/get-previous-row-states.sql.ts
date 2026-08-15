import { sql, type Sql } from 'src/engine-prisma-types';
import { BISECT_INTRODUCTIONS_SQL } from './bisect-introductions.sql';
import { EVENTS_AND_PAGINATION_SQL } from './events-and-pagination.sql';
import { BISECT_MAX_ROW_VERSIONS } from './history-selector.sql';
import { HYDRATION_SQL } from './hydration.sql';
import { LINEAGE_SQL } from './lineage.sql';
import type { PreviousRowStatesSqlParams } from './previous-row-states-sql.types';
import { SCAN_INTRODUCTIONS_SQL } from './scan-introductions.sql';

/**
 * Compose the history stages into one PostgreSQL statement.
 *
 * Every non-recursive CTE is small — O(fork hops) or O(row versions) — and
 * marked MATERIALIZED so each stage is computed exactly once and plans stay
 * shaped like the stages regardless of reference counts.
 */
export function getPreviousRowStatesSql(
  params: PreviousRowStatesSqlParams,
): Sql {
  const introductionsSql =
    params.rowVersionCount <= BISECT_MAX_ROW_VERSIONS
      ? BISECT_INTRODUCTIONS_SQL
      : SCAN_INTRODUCTIONS_SQL;

  return sql`${paramsSql(params)}${LINEAGE_SQL}${introductionsSql}${EVENTS_AND_PAGINATION_SQL}${HYDRATION_SQL}`;
}

function paramsSql({
  tipBranchId,
  tipSequence,
  projectId,
  tableCreatedId,
  rowCreatedId,
  first,
  afterSequence,
  afterRevisionId,
}: PreviousRowStatesSqlParams): Sql {
  return sql`
WITH RECURSIVE
params AS MATERIALIZED (
  SELECT
    ${tipBranchId}::text AS tip_branch_id,
    ${tipSequence}::integer AS tip_sequence,
    ${projectId}::text AS project_id,
    ${tableCreatedId}::text AS table_created_id,
    ${rowCreatedId}::text AS row_created_id,
    ${first}::integer AS first_count,
    ${afterSequence}::integer AS after_sequence,
    ${afterRevisionId}::text AS after_revision_id
)`;
}

export {
  BISECT_MAX_ROW_VERSIONS,
  getHistorySelectorSql,
} from './history-selector.sql';
export type {
  HistorySelectorSqlParams,
  HistorySelectorSqlResult,
  PreviousRowStateSqlResult,
  PreviousRowStatesSqlParams,
} from './previous-row-states-sql.types';
