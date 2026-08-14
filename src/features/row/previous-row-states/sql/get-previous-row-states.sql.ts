import { sql, type Sql } from 'src/engine-prisma-types';
import { HYDRATION_SQL } from './hydration.sql';
import { IDENTITY_SQL } from './identity.sql';
import { INTEGRITY_AND_EVENTS_SQL } from './integrity-and-events.sql';
import { PAGINATION_SQL } from './pagination.sql';
import type { PreviousRowStatesSqlParams } from './previous-row-states-sql.types';
import { selectorAndLineageSql } from './selector-and-lineage.sql';

/** Compose the five history stages into one PostgreSQL statement. */
export function getPreviousRowStatesSql(
  params: PreviousRowStatesSqlParams,
): Sql {
  return sql`${selectorAndLineageSql(params)}${IDENTITY_SQL}${INTEGRITY_AND_EVENTS_SQL}${PAGINATION_SQL}${HYDRATION_SQL}`;
}

export type {
  PreviousRowStateSqlResult,
  PreviousRowStatesSqlParams,
} from './previous-row-states-sql.types';
