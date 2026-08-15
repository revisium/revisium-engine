import { sql, type Sql } from 'src/engine-prisma-types';

/**
 * The logical row's state at the latest lineage Revision of `branch` with
 * sequence <= `sequence`: that Revision's Table version of the selected
 * identity, probed against every candidate Row version by primary key.
 * O(candidates) point probes — independent of how many Table versions share
 * each Row version. Version counts feed the duplicate-state integrity flags.
 */
function rowStateProbeSql(branch: Sql, sequence: Sql): Sql {
  return sql`
    SELECT
      min(candidate_link.row_version_id) AS row_version_id,
      count(candidate_link.row_version_id)::integer AS row_version_count,
      count(DISTINCT table_version."versionId")::integer AS table_version_count
    FROM "Revision" probe_revision
    JOIN "_RevisionToTable" revision_table
      ON revision_table."A" = probe_revision."id"
    JOIN "Table" table_version
      ON table_version."versionId" = revision_table."B"
     AND table_version."createdId" = p.table_created_id
    LEFT JOIN LATERAL (
      SELECT candidate.row_version_id
      FROM candidates candidate
      WHERE EXISTS (
        SELECT 1
        FROM "_RowToTable" row_link
        WHERE row_link."A" = candidate.row_version_id
          AND row_link."B" = table_version."versionId"
      )
    ) candidate_link ON true
    WHERE probe_revision."id" = (
      SELECT floor_revision."id"
      FROM "Revision" floor_revision
      WHERE floor_revision."branchId" = ${branch}
        AND floor_revision."sequence" <= ${sequence}
      ORDER BY floor_revision."sequence" DESC
      LIMIT 1
    )`;
}

/**
 * Introductions by bisection: within each lineage interval the row's state
 * is a step function of sequence with one step per Row version, so every
 * step boundary is found by halving segments whose endpoint states differ.
 * O(versions * log revisions) point probes, independent of how many Table
 * versions carry each Row version (the hot-table membership factor).
 *
 * Integrity flags are best-effort by construction: duplicates and
 * vanish/reappear transitions are observed at probed Revisions, which always
 * include every interval endpoint and every event boundary.
 */
export const BISECT_INTRODUCTIONS_SQL = sql`,
candidates AS MATERIALIZED (
  SELECT candidate."versionId" AS row_version_id
  FROM params p
  JOIN "Row" candidate ON candidate."createdId" = p.row_created_id
),
interval_endpoints AS MATERIALIZED (
  SELECT
    i.branch_id,
    i.lo_seq,
    i.hi_seq,
    lo_probe.row_version_id AS v_lo,
    hi_probe.row_version_id AS v_hi,
    GREATEST(
      lo_probe.table_version_count,
      hi_probe.table_version_count
    ) AS table_version_count,
    GREATEST(
      lo_probe.row_version_count,
      hi_probe.row_version_count
    ) AS row_version_count
  FROM intervals i
  CROSS JOIN params p
  LEFT JOIN LATERAL (${rowStateProbeSql(sql`i.branch_id`, sql`i.lo_seq`)}
  ) lo_probe ON true
  LEFT JOIN LATERAL (${rowStateProbeSql(sql`i.branch_id`, sql`i.hi_seq`)}
  ) hi_probe ON true
),
segments AS (
  SELECT
    endpoint.branch_id,
    endpoint.lo_seq,
    endpoint.hi_seq,
    endpoint.v_lo,
    endpoint.v_hi,
    endpoint.table_version_count,
    endpoint.row_version_count
  FROM interval_endpoints endpoint

  UNION ALL

  SELECT
    segment.branch_id,
    half.lo_seq,
    half.hi_seq,
    half.v_lo,
    half.v_hi,
    mid_probe.table_version_count,
    mid_probe.row_version_count
  FROM segments segment
  CROSS JOIN params p
  CROSS JOIN LATERAL (
    -- overflow-safe midpoint: sequence is int4 and lo + hi could exceed it
    SELECT segment.lo_seq + (segment.hi_seq - segment.lo_seq) / 2 AS mid_seq
  ) midpoint
  LEFT JOIN LATERAL (${rowStateProbeSql(
    sql`segment.branch_id`,
    sql`midpoint.mid_seq`,
  )}
  ) mid_probe ON true
  CROSS JOIN LATERAL (
    VALUES
      (segment.lo_seq, midpoint.mid_seq, segment.v_lo,
       mid_probe.row_version_id),
      (midpoint.mid_seq, segment.hi_seq, mid_probe.row_version_id,
       segment.v_hi)
  ) half(lo_seq, hi_seq, v_lo, v_hi)
  WHERE segment.v_lo IS DISTINCT FROM segment.v_hi
    AND segment.hi_seq - segment.lo_seq > 1
),
interval_seams AS MATERIALIZED (
  SELECT
    endpoint.lo_seq,
    endpoint.v_lo,
    seam.v_hi AS previous_v_hi
  FROM interval_endpoints endpoint
  LEFT JOIN LATERAL (
    SELECT previous_interval.v_hi
    FROM interval_endpoints previous_interval
    WHERE previous_interval.hi_seq < endpoint.lo_seq
    ORDER BY previous_interval.hi_seq DESC
    LIMIT 1
  ) seam ON true
),
introduction_events AS MATERIALIZED (
  -- Interior boundary: the state changed between adjacent sequences.
  SELECT segment.v_hi AS row_version_id, segment.hi_seq AS introduced_seq
  FROM segments segment
  WHERE segment.hi_seq - segment.lo_seq = 1
    AND segment.v_lo IS DISTINCT FROM segment.v_hi
    AND segment.v_hi IS NOT NULL

  UNION ALL

  -- Interval seam: the state is already present at an interval start and is
  -- not inherited from the previous interval end (covers project origin).
  SELECT seam.v_lo, seam.lo_seq
  FROM interval_seams seam
  WHERE seam.v_lo IS NOT NULL
    AND seam.previous_v_hi IS DISTINCT FROM seam.v_lo
),
introductions AS MATERIALIZED (
  SELECT row_version_id, min(introduced_seq) AS introduced_seq
  FROM introduction_events
  GROUP BY row_version_id
),
introduction_flags AS MATERIALIZED (
  SELECT
    COALESCE(
      (SELECT bool_or(segment.table_version_count > 1) FROM segments segment),
      false
    ) AS duplicate_table,
    COALESCE(
      (SELECT bool_or(segment.row_version_count > 1) FROM segments segment),
      false
    ) AS duplicate_row,
    COALESCE((
      SELECT bool_or(
        segment.hi_seq - segment.lo_seq = 1
        AND segment.v_lo IS NOT NULL
        AND segment.v_hi IS NULL
      )
      FROM segments segment
    ), false)
    OR COALESCE((
      SELECT bool_or(seam.v_lo IS NULL AND seam.previous_v_hi IS NOT NULL)
      FROM interval_seams seam
    ), false) AS row_reappears
)`;
