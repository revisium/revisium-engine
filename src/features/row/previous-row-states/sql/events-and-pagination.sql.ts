import { sql } from 'src/engine-prisma-types';

/**
 * Turn introductions into semantic events, validate keyset membership, count
 * the full previous-event stream, and select one page. totalCount is cheap
 * here: the stream size is the number of effective Row versions, which the
 * introduction stage has already materialized.
 */
export const EVENTS_AND_PAGINATION_SQL = sql`,
ordered_introductions AS MATERIALIZED (
  -- Data changes are compared through Row.hash — the persisted content hash
  -- recomputed on every data write and carried unchanged by copy-on-write —
  -- so full JSONB documents are only read for the hydrated page, never for
  -- the whole version stream.
  SELECT
    i.row_version_id,
    i.introduced_seq,
    version."id" AS row_id,
    version."hash" AS row_hash,
    lead(i.row_version_id) OVER previous_first AS parent_version_id,
    lead(version."id") OVER previous_first AS parent_row_id,
    lead(version."hash") OVER previous_first AS parent_row_hash
  FROM introductions i
  JOIN "Row" version ON version."versionId" = i.row_version_id
  WINDOW previous_first AS (ORDER BY i.introduced_seq DESC)
),
semantic_events AS MATERIALIZED (
  SELECT
    o.row_version_id,
    o.introduced_seq,
    CASE
      WHEN o.parent_version_id IS NULL THEN ARRAY['created']::text[]
      ELSE array_remove(ARRAY[
        CASE
          WHEN o.row_id IS DISTINCT FROM o.parent_row_id
          THEN 'renamed'
        END,
        CASE
          WHEN o.row_hash IS DISTINCT FROM o.parent_row_hash
          THEN 'modified'
        END
      ], NULL)
    END AS introduced_by,
    row_number() OVER (ORDER BY o.introduced_seq DESC) AS event_number
  FROM ordered_introductions o
  -- A copy-on-write no-op introduces a new versionId with identical content;
  -- it is not a semantic event.
  WHERE o.parent_version_id IS NULL
     OR o.row_id IS DISTINCT FROM o.parent_row_id
     OR o.row_hash IS DISTINCT FROM o.parent_row_hash
),
previous_events AS MATERIALIZED (
  SELECT
    event.row_version_id,
    event.introduced_seq,
    event.introduced_by,
    event_revision."id" AS revision_id
  FROM semantic_events event
  -- Revision.sequence is globally unique (schema-level @unique), so the
  -- sequence alone identifies the event Revision across branches.
  JOIN "Revision" event_revision
    ON event_revision."sequence" = event.introduced_seq
  WHERE event.event_number > 1
),
cursor_check AS MATERIALIZED (
  SELECT
    params.after_sequence IS NULL
    OR EXISTS (
      SELECT 1
      FROM previous_events event
      WHERE event.introduced_seq = params.after_sequence
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
    AND (
      params.after_sequence IS NULL
      OR event.introduced_seq < params.after_sequence
    )
  ORDER BY event.introduced_seq DESC
  LIMIT (SELECT first_count + 1 FROM params)
),
page AS MATERIALIZED (
  SELECT event.*
  FROM page_plus_one event
  ORDER BY event.introduced_seq DESC
  LIMIT (SELECT first_count FROM params)
),
metadata AS MATERIALIZED (
  SELECT
    lineage_integrity.has_cycle,
    lineage_integrity.has_gap,
    lineage_integrity.has_draft,
    lineage_integrity.crosses_project,
    introduction_flags.duplicate_table,
    introduction_flags.duplicate_row,
    introduction_flags.row_reappears,
    cursor_check.cursor_valid,
    (SELECT count(*) FROM previous_events) AS total_count,
    (SELECT count(*) > params.first_count FROM page_plus_one) AS has_next_page
  FROM lineage_integrity
  CROSS JOIN introduction_flags
  CROSS JOIN cursor_check
  CROSS JOIN params
)`;
