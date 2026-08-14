import { sql } from 'src/engine-prisma-types';

// Validate keyset membership, count all events, and select one page.
export const PAGINATION_SQL = sql`,
cursor_check AS MATERIALIZED (
  SELECT
    params.after_depth IS NULL
    OR EXISTS (
      SELECT 1
      FROM previous_events event
      WHERE event.depth = params.after_depth
        AND event.revision_id = params.after_revision_id
    ) AS cursor_valid
  FROM params
),
page_plus_one AS MATERIALIZED (
  SELECT event.*
  FROM previous_events event
  CROSS JOIN params
  CROSS JOIN cursor_check
  WHERE cursor_check.cursor_valid
    AND (params.after_depth IS NULL OR event.depth > params.after_depth)
  ORDER BY event.depth
  LIMIT (SELECT first_count + 1 FROM params)
),
page AS MATERIALIZED (
  SELECT event.*
  FROM page_plus_one event
  ORDER BY event.depth
  LIMIT (SELECT first_count FROM params)
),
metadata AS MATERIALIZED (
  SELECT
    selected.selector_count,
    selected.project_id,
    selected.table_created_id,
    selected.row_created_id,
    integrity.has_cycle,
    integrity.has_gap,
    integrity.has_draft,
    integrity.crosses_project,
    integrity.duplicate_table,
    integrity.duplicate_row,
    integrity.row_reappears,
    cursor_check.cursor_valid,
    (SELECT count(*) FROM previous_events) AS total_count,
    (SELECT count(*) > params.first_count FROM page_plus_one) AS has_next_page
  FROM selected
  CROSS JOIN integrity
  CROSS JOIN cursor_check
  CROSS JOIN params
)`;
