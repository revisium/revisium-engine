import { join, raw, sql, type Sql } from 'src/engine-prisma-types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import {
  ROW_VERSIONS_PAIRED_BY_IDENTITY,
  unsharedRowVersionsCtes,
} from 'src/features/partial-changes/snapshot/changed-row-pairs-sql';
import type { ComparedTable } from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  columnDiffers,
  rowChangePredicate,
} from 'src/features/partial-changes/snapshot/row-change-predicate';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';
import { ChangeType } from 'src/features/revision-changes/types';
import {
  COMPARED_ROW_COLUMNS,
  type ComparedRowColumn,
} from 'src/features/share/compared-columns';

export interface ComparedRows {
  readonly kind: 'compared';
  readonly table: ComparedTable;
}

export interface OneSidedRows {
  readonly kind: 'oneSided';
  readonly side: RevisionSide;
  readonly tableVersionId: string;
}

export type TableRows = ComparedRows | OneSidedRows;

const ONE_SIDED = raw(`(h."versionId" IS NULL OR d."versionId" IS NULL)`);

const IDS_DIFFER = raw(`h."id" <> d."id"`);

const PAIR_ON_ONE_SIDE = raw(
  `("headVersionId" IS NULL OR "draftVersionId" IS NULL)`,
);

export function reportedRowCountsSql(rows: TableRows): Sql {
  if (rows.kind === 'oneSided') {
    return oneSidedRowCountsSql(rows);
  }

  return sql`
    WITH ${comparedPairsCtes(rows.table)}
    SELECT
      count(*)::int AS "total",
      count(*) FILTER (WHERE "changeType" = ${ChangeType.Added})::int AS "added",
      count(*) FILTER (WHERE "changeType" = ${ChangeType.Removed})::int AS "removed",
      count(*) FILTER (
        WHERE "changeType" = ANY(${[ChangeType.Renamed, ChangeType.RenamedAndModified]}::text[])
      )::int AS "renamed",
      count(*) FILTER (
        WHERE "changeType" = ANY(${[ChangeType.Modified, ChangeType.RenamedAndModified]}::text[])
      )::int AS "modified",
      ${rowsWithUnitsCount()} AS "rowsWithUnits"
    FROM pairs
  `;
}

// Every row of a table on one side only is reported, and goes with its structure.
function oneSidedRowCountsSql({ side, tableVersionId }: OneSidedRows): Sql {
  const added = side === 'draft' ? raw('count(*)::int') : raw('0');
  const removed = side === 'head' ? raw('count(*)::int') : raw('0');

  return sql`
    SELECT count(*)::int AS "total", ${added} AS "added", ${removed} AS "removed",
           0 AS "renamed", 0 AS "modified", 0 AS "rowsWithUnits"
    FROM "_RowToTable" WHERE "B" = ${tableVersionId}
  `;
}

// Rows count as their row selectors: the deleted and the created row of a replace share their row id and one selector.
function rowsWithUnitsCount(): Sql {
  return sql`(
    count(*) FILTER (WHERE "yieldsUnit" AND NOT ${PAIR_ON_ONE_SIDE})
    + count(DISTINCT "rowId") FILTER (WHERE "yieldsUnit" AND ${PAIR_ON_ONE_SIDE})
  )::int`;
}

function comparedPairsCtes(table: ComparedTable): Sql {
  const { structure } = table;

  return sql`
    ${unsharedRowVersionsCtes(table)},
    pairs AS (
      SELECT coalesce(d."id", h."id") AS "rowId",
             h."versionId" AS "headVersionId", d."versionId" AS "draftVersionId",
             ${changeTypeOf(structure)} AS "changeType",
             (${ONE_SIDED} OR ${rowChangePredicate(structure)}) AS "yieldsUnit"
      FROM ${ROW_VERSIONS_PAIRED_BY_IDENTITY}
      WHERE ${ONE_SIDED} OR ${anyDiffers(reportedColumnsOf(structure))}
    )
  `;
}

function changeTypeOf(structure: TableStructure): Sql {
  const modified = anyDiffers(modifyingColumnsOf(structure));

  return sql`CASE
    WHEN h."versionId" IS NULL THEN ${ChangeType.Added}::text
    WHEN d."versionId" IS NULL THEN ${ChangeType.Removed}::text
    WHEN ${IDS_DIFFER} AND (${modified}) THEN ${ChangeType.RenamedAndModified}::text
    WHEN ${IDS_DIFFER} THEN ${ChangeType.Renamed}::text
    ELSE ${ChangeType.Modified}::text
  END`;
}

// A schema update rewrites every row of its table with the new schema hash, and the table item shows the structure.
function reportedColumnsOf(structure: TableStructure): ComparedRowColumn[] {
  return COMPARED_ROW_COLUMNS.filter(
    (column) => column !== 'schemaHash' || !structure.differs,
  );
}

function modifyingColumnsOf(structure: TableStructure): ComparedRowColumn[] {
  return reportedColumnsOf(structure).filter((column) => column !== 'id');
}

function anyDiffers(columns: readonly ComparedRowColumn[]): Sql {
  return join(columns.map(columnDiffers), ' OR ');
}
