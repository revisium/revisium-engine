import { sql } from 'src/engine-prisma-types';

// Validate the complete lineage before deriving semantic row events.
export const INTEGRITY_AND_EVENTS_SQL = sql`,
states AS MATERIALIZED (
  SELECT
    lineage.revision_id,
    lineage.parent_id,
    lineage.branch_id,
    branch."projectId" AS project_id,
    lineage.is_draft,
    lineage.is_start,
    lineage.sequence,
    lineage.depth,
    count(DISTINCT table_candidate.table_version_id)::integer AS table_count,
    count(row_candidate.row_version_id)::integer AS row_count,
    max(table_candidate.table_version_id) AS table_version_id,
    max(table_candidate.table_id) AS table_id,
    max(row_candidate.row_version_id) AS row_version_id,
    max(row_candidate.row_id) AS row_id,
    max(row_candidate.row_data::text)::jsonb AS row_data
  FROM lineage
  LEFT JOIN "Branch" branch ON branch."id" = lineage.branch_id
  LEFT JOIN table_candidates table_candidate
    ON table_candidate.revision_id = lineage.revision_id
  LEFT JOIN row_candidates row_candidate
    ON row_candidate.revision_id = lineage.revision_id
   AND row_candidate.table_version_id = table_candidate.table_version_id
  GROUP BY
    lineage.revision_id,
    lineage.parent_id,
    lineage.branch_id,
    branch."projectId",
    lineage.is_draft,
    lineage.is_start,
    lineage.sequence,
    lineage.depth
),
integrity AS MATERIALIZED (
  SELECT
    selected.selector_count,
    COALESCE((
      SELECT deepest.parent_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM "Revision" invalid_parent
          WHERE invalid_parent."id" = deepest.parent_id
            AND invalid_parent."sequence" >= deepest.sequence
        )
      FROM states deepest
      ORDER BY deepest.depth DESC
      LIMIT 1
    ), false) AS has_cycle,
    COALESCE((
      SELECT
        (
          deepest.parent_id IS NULL
          AND (
            deepest.is_start = false
            OR EXISTS (
              -- Engine-created fork starts are causally later than their
              -- source Revision. The original project start has no older
              -- Revision in that Project, independently of Branch.isRoot.
              SELECT 1
              FROM "Revision" older_revision
              JOIN "Branch" older_branch
                ON older_branch."id" = older_revision."branchId"
              WHERE older_branch."projectId" = selected.project_id
                AND older_revision."sequence" < deepest.sequence
            )
          )
        )
        OR (
          deepest.parent_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM "Revision" missing_parent
            WHERE missing_parent."id" = deepest.parent_id
          )
        )
      FROM states deepest
      ORDER BY deepest.depth DESC
      LIMIT 1
    ), false) AS has_gap,
    COALESCE((
      SELECT bool_or(state.is_draft) FROM states state
    ), false) AS has_draft,
    COALESCE((
      SELECT bool_or(state.project_id IS DISTINCT FROM selected.project_id)
      FROM states state
    ), false) AS crosses_project,
    COALESCE((
      SELECT bool_or(state.table_count > 1) FROM states state
    ), false) AS duplicate_table,
    COALESCE((
      SELECT bool_or(state.row_count > 1) FROM states state
    ), false) AS duplicate_row,
    COALESCE((
      SELECT EXISTS (
        SELECT 1
        FROM states older_state
        WHERE older_state.row_count > 0
          AND older_state.depth > (
            SELECT min(absent_state.depth)
            FROM states absent_state
            WHERE absent_state.row_count = 0
          )
      )
    ), false) AS row_reappears
  FROM selected
),
compared AS MATERIALIZED (
  SELECT
    state.*,
    state.row_count > 0 AS present,
    COALESCE(
      lead(state.row_count > 0) OVER (ORDER BY state.depth),
      false
    ) AS parent_present,
    lead(state.row_id) OVER (ORDER BY state.depth) AS parent_row_id,
    lead(state.row_data) OVER (ORDER BY state.depth) AS parent_row_data
  FROM states state
),
semantic_events AS MATERIALIZED (
  SELECT
    compared.*,
    CASE
      WHEN NOT compared.parent_present THEN ARRAY['created']::text[]
      ELSE array_remove(ARRAY[
        CASE
          WHEN compared.row_id IS DISTINCT FROM compared.parent_row_id
          THEN 'renamed'
        END,
        CASE
          WHEN compared.row_data IS DISTINCT FROM compared.parent_row_data
          THEN 'modified'
        END
      ], NULL)
    END AS introduced_by,
    row_number() OVER (ORDER BY compared.depth) AS event_number
  FROM compared
  WHERE compared.present
    AND (
      NOT compared.parent_present
      OR compared.row_id IS DISTINCT FROM compared.parent_row_id
      OR compared.row_data IS DISTINCT FROM compared.parent_row_data
    )
),
previous_events AS MATERIALIZED (
  SELECT * FROM semantic_events WHERE event_number > 1
)`;
