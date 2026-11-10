import { join, raw, sql, type Sql } from 'src/engine-prisma-types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { TableFilters } from 'src/features/partial-changes/draft-reads/draft-read-request';
import { changeTypesMatching } from 'src/features/partial-changes/draft-reads/table-filters';
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

export interface ReportedRowPair {
  readonly identity: string;
  readonly rowId: string;
  readonly headVersionId: string | null;
  readonly draftVersionId: string | null;
  readonly changeType: ChangeType;
  readonly yieldsUnit: boolean;
}

// The pairs of a page with whether a matching row follows them, and the other pairs of their row ids, which a filter
// leaves out but the page's catalogue needs: a replaced row's two rows, a deleted row and the rename into its id.
export interface ReportedRowPairsPage {
  readonly pairs: readonly ReportedRowPair[];
  readonly hasMore: boolean;
  readonly companions: readonly ReportedRowPair[];
}

// The rows after a row id (or from the first), up to a limit of items, completed with the items of the last row id.
export interface RowRange {
  readonly afterRowId?: string;
  readonly limit: number;
}

const ONE_SIDED = raw(`(h."versionId" IS NULL OR d."versionId" IS NULL)`);

const IDS_DIFFER = raw(`h."id" <> d."id"`);

const PAIR_ON_ONE_SIDE = raw(
  `("headVersionId" IS NULL OR "draftVersionId" IS NULL)`,
);

const HEAD_ONLY_PAIR_FIRST = raw(`p."draftVersionId" IS NOT NULL`);

const PAIR_JSON = raw(`json_build_object(
  'identity', p."identity",
  'rowId', p."rowId",
  'headVersionId', p."headVersionId",
  'draftVersionId', p."draftVersionId",
  'changeType', p."changeType",
  'yieldsUnit', p."yieldsUnit"
)`);

// Of two items with one row id, the row that exists only in Head comes first. The matching rows are inlined into the
// page and the look-ahead, so an unfiltered page scans the pairs as it did before the filters.
export function reportedRowPairsPageSql(
  rows: TableRows,
  filters: TableFilters,
  { afterRowId, limit }: RowRange,
): Sql {
  return sql`
    WITH ${reportedPairsCtes(rows)},
    matching AS NOT MATERIALIZED (
      SELECT * FROM pairs WHERE ${rowsMatching(filters)}
    ),
    page AS (
      SELECT * FROM matching WHERE ${rowsAfter(afterRowId)}
      ORDER BY "rowId" COLLATE "C"
      FETCH FIRST ${limit} ROWS WITH TIES
    )
    SELECT
      (
        SELECT coalesce(json_agg(${PAIR_JSON} ORDER BY p."rowId" COLLATE "C", ${HEAD_ONLY_PAIR_FIRST}), '[]')
        FROM page p
      ) AS "pairs",
      EXISTS (
        SELECT 1 FROM matching
        WHERE "rowId" COLLATE "C" > (SELECT max("rowId" COLLATE "C") FROM page)
      ) AS "hasMore",
      ${companionsOf(rows, filters)} AS "companions"
  `;
}

// The pairs with units at the page's row ids that the filters left out. Only a compared table holds two pairs at one row
// id, and only a filter on rows can leave one of them out.
function companionsOf(
  rows: TableRows,
  { changeTypes, search }: TableFilters,
): Sql {
  if (
    rows.kind === 'oneSided' ||
    (changeTypes === undefined && search === undefined)
  ) {
    return raw(`'[]'::json`);
  }

  return sql`(
    SELECT coalesce(json_agg(${PAIR_JSON}), '[]')
    FROM pairs p
    WHERE p."yieldsUnit"
      AND p."rowId" IN (SELECT "rowId" FROM page)
      AND p."identity" NOT IN (SELECT "identity" FROM page)
  )`;
}

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

function reportedPairsCtes(rows: TableRows): Sql {
  if (rows.kind === 'compared') {
    return comparedPairsCtes(rows.table);
  }

  return oneSidedPairsCte(rows);
}

function comparedPairsCtes(table: ComparedTable): Sql {
  const { structure } = table;

  return sql`
    ${unsharedRowVersionsCtes(table)},
    pairs AS (
      SELECT coalesce(h."createdId", d."createdId") AS "identity",
             coalesce(d."id", h."id") AS "rowId",
             h."id" AS "headRowId",
             h."versionId" AS "headVersionId", d."versionId" AS "draftVersionId",
             ${changeTypeOf(structure)} AS "changeType",
             (${ONE_SIDED} OR ${rowChangePredicate(structure)}) AS "yieldsUnit"
      FROM ${ROW_VERSIONS_PAIRED_BY_IDENTITY}
      WHERE ${ONE_SIDED} OR ${anyDiffers(reportedColumnsOf(structure))}
    )
  `;
}

function oneSidedPairsCte({ side, tableVersionId }: OneSidedRows): Sql {
  return sql`
    pairs AS (
      SELECT r."createdId" AS "identity", r."id" AS "rowId",
             ${oneSidedColumns(side)},
             ${oneSidedChangeType(side)} AS "changeType",
             FALSE AS "yieldsUnit"
      FROM "_RowToTable" link
      JOIN "Row" r ON r."versionId" = link."A"
      WHERE link."B" = ${tableVersionId}
    )
  `;
}

function oneSidedColumns(side: RevisionSide): Sql {
  if (side === 'head') {
    return raw(
      `r."id" AS "headRowId", r."versionId" AS "headVersionId", NULL::text AS "draftVersionId"`,
    );
  }

  return raw(
    `NULL::text AS "headRowId", NULL::text AS "headVersionId", r."versionId" AS "draftVersionId"`,
  );
}

function oneSidedChangeType(side: RevisionSide): Sql {
  if (side === 'head') {
    return sql`${ChangeType.Removed}::text`;
  }

  return sql`${ChangeType.Added}::text`;
}

function rowsMatching({ changeTypes, search }: TableFilters): Sql {
  return sql`${changeTypeMatches(changeTypes)} AND ${searchMatches(search)}`;
}

function changeTypeMatches(
  changeTypes: readonly ChangeType[] | undefined,
): Sql {
  if (changeTypes === undefined) {
    return sql`TRUE`;
  }

  return sql`"changeType" = ANY(${changeTypesMatching(changeTypes)}::text[])`;
}

// A plain substring of the Head or the Draft row id, so '_' and '%' are no wildcards; row ids are ASCII.
function searchMatches(search: string | undefined): Sql {
  if (search === undefined) {
    return sql`TRUE`;
  }

  const term = search.toLowerCase();

  return sql`(strpos(lower("rowId"), ${term}) > 0 OR strpos(lower("headRowId"), ${term}) > 0)`;
}

function rowsAfter(rowId: string | undefined): Sql {
  if (rowId === undefined) {
    return sql`TRUE`;
  }

  return sql`"rowId" COLLATE "C" > ${rowId}`;
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
