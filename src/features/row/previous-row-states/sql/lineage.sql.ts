import { sql } from 'src/engine-prisma-types';

/**
 * Fork ancestry as (branch, max sequence) intervals: one recursion step per
 * fork hop instead of one per Revision. A Revision belongs to the selected
 * lineage iff its branch is listed and its sequence is within the interval,
 * because a branch chain is linear and a start's parent lives in the source
 * branch at the fork sequence.
 */
export const LINEAGE_SQL = sql`,
branch_lineage AS (
  SELECT
    p.tip_branch_id AS branch_id,
    p.tip_sequence AS max_seq,
    ARRAY[p.tip_branch_id] AS visited_branches,
    false AS is_cycle
  FROM params p

  UNION ALL

  SELECT
    parent_revision."branchId",
    parent_revision."sequence",
    child.visited_branches || parent_revision."branchId",
    parent_revision."branchId" = ANY (child.visited_branches)
  FROM branch_lineage child
  JOIN "Revision" start_revision
    ON start_revision."branchId" = child.branch_id
   AND start_revision."isStart" = true
  JOIN "Revision" parent_revision
    ON parent_revision."id" = start_revision."parentId"
  WHERE NOT child.is_cycle
),
lineage AS MATERIALIZED (
  SELECT branch_id, max_seq FROM branch_lineage WHERE NOT is_cycle
),
lineage_starts AS MATERIALIZED (
  SELECT
    l.branch_id,
    l.max_seq,
    min(start_revision."sequence") AS start_sequence,
    bool_or(start_revision."parentId" IS NOT NULL) AS has_parent_link,
    bool_or(
      start_revision."parentId" IS NOT NULL
      AND parent_revision."id" IS NULL
    ) AS parent_missing
  FROM lineage l
  LEFT JOIN "Revision" start_revision
    ON start_revision."branchId" = l.branch_id
   AND start_revision."isStart" = true
  LEFT JOIN "Revision" parent_revision
    ON parent_revision."id" = start_revision."parentId"
  GROUP BY l.branch_id, l.max_seq
),
intervals AS MATERIALIZED (
  SELECT branch_id, start_sequence AS lo_seq, max_seq AS hi_seq
  FROM lineage_starts
  WHERE start_sequence IS NOT NULL
),
lineage_integrity AS MATERIALIZED (
  SELECT
    COALESCE(
      (SELECT bool_or(bl.is_cycle) FROM branch_lineage bl),
      false
    ) AS has_cycle,
    COALESCE((
      SELECT bool_or(
        ls.start_sequence IS NULL
        OR ls.parent_missing
        OR (
          NOT COALESCE(ls.has_parent_link, false)
          AND EXISTS (
            -- Engine-created fork starts are causally later than their
            -- source Revision. The original project start has no older
            -- Revision in that Project, independently of Branch.isRoot.
            -- Driven from Branch with one first-sequence probe per branch
            -- so the check never scans the Revision table itself.
            SELECT 1
            FROM "Branch" older_branch
            CROSS JOIN params p
            JOIN LATERAL (
              SELECT branch_revision."sequence"
              FROM "Revision" branch_revision
              WHERE branch_revision."branchId" = older_branch."id"
              ORDER BY branch_revision."sequence"
              LIMIT 1
            ) first_revision ON true
            WHERE older_branch."projectId" = p.project_id
              AND first_revision."sequence" < ls.start_sequence
          )
        )
      )
      FROM lineage_starts ls
    ), false) AS has_gap,
    COALESCE((
      SELECT bool_or(EXISTS (
        SELECT 1
        FROM "Revision" draft_revision
        WHERE draft_revision."branchId" = l.branch_id
          AND draft_revision."isDraft" = true
          AND draft_revision."sequence" <= l.max_seq
      ))
      FROM lineage l
    ), false) AS has_draft,
    COALESCE((
      SELECT bool_or(branch."projectId" IS DISTINCT FROM p.project_id)
      FROM lineage l
      JOIN "Branch" branch ON branch."id" = l.branch_id
      CROSS JOIN params p
    ), false) AS crosses_project
)`;
