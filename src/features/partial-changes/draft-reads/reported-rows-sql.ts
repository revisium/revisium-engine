import { join, raw, sql, type Sql } from 'src/engine-prisma-types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { RowFilters } from 'src/features/partial-changes/draft-reads/draft-read-request';
import { changeTypesMatching } from 'src/features/partial-changes/draft-reads/table-filters';
import {
  ROW_VERSIONS_PAIRED_BY_IDENTITY,
  unsharedRowVersionsCtes,
} from 'src/features/partial-changes/snapshot/changed-row-pairs-sql';
import type { ComparedTable } from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  columnDiffers,
  leafDiffers,
  rowChangePredicate,
} from 'src/features/partial-changes/snapshot/row-change-predicate';
import {
  columnOwnerOf,
  type LeafOwner,
  leafOwnersOf,
} from 'src/features/partial-changes/structure/column-owners';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';
import type { DraftRowChangeKind } from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import { ChangeType } from 'src/features/revision-changes/types';

interface ComparedRows {
  readonly kind: 'compared';
  readonly table: ComparedTable;
}

interface OneSidedRows {
  readonly kind: 'oneSided';
  readonly side: RevisionSide;
  readonly tableVersionId: string;
}

export type TableRows = ComparedRows | OneSidedRows;

// changedAt: the time of the row's last change in the Draft, in UTC to the millisecond; null for a removed row.
export interface ReportedRowPair {
  readonly identity: string;
  readonly rowId: string;
  readonly headVersionId: string | null;
  readonly draftVersionId: string | null;
  readonly changeType: ChangeType;
  readonly replaced: boolean;
  readonly yieldsUnit: boolean;
  readonly changedAt: string | null;
}

// The pairs of a page with whether a matching row follows them, and the other pairs of their row ids, which a filter
// leaves out but the page's catalogue needs: a replaced row's two rows, a deleted row and the rename into its id.
export interface ReportedRowPairsPage {
  readonly pairs: readonly ReportedRowPair[];
  readonly hasMore: boolean;
  readonly companions: readonly ReportedRowPair[];
}

// The rows after a position of the order (or from the first), up to a limit of items, completed with the items that
// share the last position: the items of one row id in the id order, a replaced row's two items in the recent order.
export type RowRange = { readonly limit: number } & (
  | { readonly orderBy: 'id'; readonly afterRowId?: string }
  | { readonly orderBy: 'recent'; readonly after?: RecentRowKey }
);

export interface RecentRowKey {
  readonly changedAt: string | null;
  readonly rowId: string;
}

const ONE_SIDED = raw(`(h."versionId" IS NULL OR d."versionId" IS NULL)`);

const IDS_DIFFER = raw(`h."id" <> d."id"`);

const NOTHING_DIFFERS = raw('FALSE');

const UNIT_COLUMNS = ['publishedAt', 'meta', 'schemaHash'] as const;

const PAIR_ON_ONE_SIDE = raw(
  `("headVersionId" IS NULL OR "draftVersionId" IS NULL)`,
);

// The row ids of the replaced rows: a deleted and a created row at one id are the two pairs on one side only there.
// Only the pairs on one side are grouped, so a table of edited rows pays no sort or window over its pairs. The time of
// a replaced row is that of its created row, the only one of the two with a Draft version.
const REPLACED_ROW_IDS = sql`replaced_row_ids AS (
  SELECT "rowId", max("draftUpdatedAt") AS "changedAt" FROM reported WHERE ${PAIR_ON_ONE_SIDE}
  GROUP BY "rowId" HAVING count(*) = 2
)`;

const REPORTED = raw('reported AS');

// The row ids of the pairs on one side only, which always yield a unit in a compared table. The row counts use this one
// aggregate twice, so the database sorts those pairs once.
const ONE_SIDED_ROW_IDS = sql`count(DISTINCT "rowId") FILTER (WHERE ${PAIR_ON_ONE_SIDE})`;

const HEAD_ONLY_PAIR_FIRST = raw(`p."draftVersionId" IS NOT NULL`);

const PAIRS = raw('pairs AS');

// A page reads the pairs through its matching rows twice, in the page and the look-ahead, so it builds them once.
const MATERIALIZED_PAIRS = raw('pairs AS MATERIALIZED');

const PAIR_JSON = raw(`json_build_object(
  'identity', p."identity",
  'rowId', p."rowId",
  'headVersionId', p."headVersionId",
  'draftVersionId', p."draftVersionId",
  'changeType', p."changeType",
  'replaced', p."replaced",
  'yieldsUnit', p."yieldsUnit",
  'changedAt', to_char(p."changedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)`);

const BY_ROW_ID = raw(`"rowId" COLLATE "C"`);

// Rows with a time newest first, then the removed rows; ties by row id.
const BY_RECENT_CHANGE = raw(
  `("changedAt" IS NULL), "changedAt" DESC, "rowId" COLLATE "C"`,
);

const BY_RECENT_CHANGE_REVERSED = raw(
  `("changedAt" IS NULL) DESC, "changedAt" ASC, "rowId" COLLATE "C" DESC`,
);

// Of two items at one position, the row that exists only in Head comes first.
export function reportedRowPairsPageSql(
  rows: TableRows,
  filters: RowFilters,
  range: RowRange,
): Sql {
  const order = orderOf(range);

  return sql`
    WITH ${reportedPairsCtes(rows, MATERIALIZED_PAIRS)},
    matching AS NOT MATERIALIZED (
      SELECT * FROM pairs p WHERE ${rowsMatching(filters)}
    ),
    page AS (
      SELECT * FROM matching WHERE ${order.after}
      ORDER BY ${order.keys}
      FETCH FIRST ${range.limit} ROWS WITH TIES
    )
    SELECT
      (
        SELECT coalesce(json_agg(${PAIR_JSON} ORDER BY ${order.keys}, ${HEAD_ONLY_PAIR_FIRST}), '[]')
        FROM page p
      ) AS "pairs",
      ${order.followsPage} AS "hasMore",
      ${companionsOf(rows, filters, range)} AS "companions"
  `;
}

interface PageOrder {
  readonly keys: Sql;
  readonly after: Sql;
  readonly followsPage: Sql;
}

function orderOf(range: RowRange): PageOrder {
  if (range.orderBy === 'recent') {
    return {
      keys: BY_RECENT_CHANGE,
      after: recentRowsAfter(range.after),
      followsPage: sql`EXISTS (
        WITH last_line AS (
          SELECT "changedAt" AS "lastChangedAt", "rowId" AS "lastRowId" FROM page
          ORDER BY ${BY_RECENT_CHANGE_REVERSED} LIMIT 1
        )
        SELECT 1 FROM matching, last_line
        WHERE ${recentAfter(raw('last_line."lastChangedAt"'), raw('last_line."lastRowId"'))}
      )`,
    };
  }

  return {
    keys: BY_ROW_ID,
    after: rowsAfter(range.afterRowId),
    followsPage: sql`EXISTS (
      SELECT 1 FROM matching
      WHERE "rowId" COLLATE "C" > (SELECT max("rowId" COLLATE "C") FROM page)
    )`,
  };
}

// The pairs with units at the page's row ids that the page leaves out, which its catalogue needs. Only a compared table
// holds two pairs at one row id; a filter on rows can leave one of them out, and the recent order places a deleted row
// after the rename that took over its id.
function companionsOf(
  rows: TableRows,
  { changeTypes, search, rowIds }: RowFilters,
  { orderBy }: RowRange,
): Sql {
  if (
    rows.kind === 'oneSided' ||
    (orderBy === 'id' &&
      changeTypes === undefined &&
      search === undefined &&
      rowIds === undefined)
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
    WITH ${comparedPairsCtes(rows.table)},
    counts AS (
      SELECT
      count(*) AS "pairs",
      count(*) FILTER (WHERE "changeType" = ${ChangeType.Added}) AS "addedPairs",
      count(*) FILTER (WHERE "changeType" = ${ChangeType.Removed}) AS "removedPairs",
      ${replacedRowsCount()} AS "replaced",
      count(*) FILTER (
        WHERE "changeType" = ANY(${[ChangeType.Renamed, ChangeType.RenamedAndModified]}::text[])
      )::int AS "renamed",
      count(*) FILTER (
        WHERE "changeType" = ANY(${[ChangeType.Modified, ChangeType.RenamedAndModified]}::text[])
      )::int AS "modified",
      ${rowsWithUnitsCount()} AS "rowsWithUnits",
      EXISTS (
        SELECT 1 FROM ${ROW_VERSIONS_PAIRED_BY_IDENTITY}
        WHERE ${ONE_SIDED} OR ${rowHasUnitsOfItsOwn(rows.table.structure)}
      ) AS "hasRowUnits"
      FROM pairs
    )
    SELECT ("pairs" - "replaced")::int AS "total",
           ("addedPairs" - "replaced")::int AS "added",
           ("removedPairs" - "replaced")::int AS "removed",
           "replaced"::int AS "replaced",
           "renamed", "modified", "rowsWithUnits", "hasRowUnits"
    FROM counts
  `;
}

// A row id holds at most one pair on each side only, and a replaced row both: each replaced row adds one pair on one
// side to its distinct row id. So it is counted without marking the pairs, which would sort every pair of the table.
function replacedRowsCount(): Sql {
  return sql`(count(*) FILTER (WHERE ${PAIR_ON_ONE_SIDE}) - ${ONE_SIDED_ROW_IDS})`;
}

// Every row of a table on one side only is reported, and goes with its structure.
function oneSidedRowCountsSql({ side, tableVersionId }: OneSidedRows): Sql {
  const added = side === 'draft' ? raw('count(*)::int') : raw('0');
  const removed = side === 'head' ? raw('count(*)::int') : raw('0');

  return sql`
    SELECT count(*)::int AS "total", ${added} AS "added", ${removed} AS "removed",
           0 AS "renamed", 0 AS "modified", 0 AS "replaced", 0 AS "rowsWithUnits", FALSE AS "hasRowUnits"
    FROM "_RowToTable" WHERE "B" = ${tableVersionId}
  `;
}

// Rows count as their row selectors: the deleted and the created row of a replace share their row id and one selector.
function rowsWithUnitsCount(): Sql {
  return sql`(
    count(*) FILTER (WHERE "yieldsUnit" AND NOT ${PAIR_ON_ONE_SIDE})
    + ${ONE_SIDED_ROW_IDS}
  )::int`;
}

function reportedPairsCtes(rows: TableRows, pairs: Sql): Sql {
  if (rows.kind === 'compared') {
    return comparedPairsWithReplacedCtes(rows.table, pairs);
  }

  return oneSidedPairsCte(rows, pairs);
}

function comparedPairsCtes(table: ComparedTable, pairs: Sql = PAIRS): Sql {
  const { structure } = table;

  return sql`
    ${unsharedRowVersionsCtes(table)},
    ${pairs} (
      SELECT coalesce(h."createdId", d."createdId") AS "identity",
             coalesce(d."id", h."id") AS "rowId",
             h."id" AS "headRowId",
             h."versionId" AS "headVersionId", d."versionId" AS "draftVersionId",
             d."updatedAt" AS "draftUpdatedAt",
             ${changeTypeOf(structure)} AS "changeType",
             (${ONE_SIDED} OR ${rowChangePredicate(structure)}) AS "yieldsUnit"
      FROM ${ROW_VERSIONS_PAIRED_BY_IDENTITY}
      WHERE ${ONE_SIDED} OR ${IDS_DIFFER} OR ${contentWithEffectDiffers(structure)}
    )
  `;
}

// The pairs of a compared table, each marked whether it is one of the two items of a replaced row.
function comparedPairsWithReplacedCtes(table: ComparedTable, pairs: Sql): Sql {
  return sql`
    ${comparedPairsCtes(table, REPORTED)},
    ${REPLACED_ROW_IDS},
    ${pairs} (
      SELECT r.*, replaced."rowId" IS NOT NULL AS "replaced",
             coalesce(replaced."changedAt", r."draftUpdatedAt") AS "changedAt"
      FROM reported r
      LEFT JOIN replaced_row_ids replaced ON ${PAIR_ON_ONE_SIDE} AND replaced."rowId" = r."rowId"
    )
  `;
}

function oneSidedPairsCte(
  { side, tableVersionId }: OneSidedRows,
  pairs: Sql,
): Sql {
  return sql`
    ${pairs} (
      SELECT r."createdId" AS "identity", r."id" AS "rowId",
             ${oneSidedColumns(side)},
             ${oneSidedChangeType(side)} AS "changeType",
             FALSE AS "replaced",
             ${oneSidedChangedAt(side)} AS "changedAt",
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

function oneSidedChangedAt(side: RevisionSide): Sql {
  if (side === 'head') {
    return raw('NULL::timestamp(3)');
  }

  return raw('r."updatedAt"');
}

function oneSidedChangeType(side: RevisionSide): Sql {
  if (side === 'head') {
    return sql`${ChangeType.Removed}::text`;
  }

  return sql`${ChangeType.Added}::text`;
}

function rowsMatching({ changeTypes, search, rowIds }: RowFilters): Sql {
  return sql`${kindMatches(changeTypes)} AND ${searchMatches(search)} AND ${rowIdMatches(rowIds)}`;
}

// A replaced row is of its own kind, so its two items match together.
function kindMatches(kinds: readonly DraftRowChangeKind[] | undefined): Sql {
  if (kinds === undefined) {
    return sql`TRUE`;
  }

  const replacedMatches = kinds.includes('REPLACED')
    ? raw('TRUE')
    : raw('FALSE');

  return sql`CASE WHEN p."replaced" THEN ${replacedMatches}
    ELSE p."changeType" = ANY(${changeTypesMatching(kinds)}::text[]) END`;
}

// The rows that show one of the ids; a renamed row also by its Head id while no row of its table holds that id.
function rowIdMatches(rowIds: readonly string[] | undefined): Sql {
  if (rowIds === undefined) {
    return sql`TRUE`;
  }

  return sql`(
    p."rowId" = ANY(${rowIds}::text[])
    OR (
      p."headRowId" = ANY(${rowIds}::text[])
      AND NOT EXISTS (SELECT 1 FROM pairs holder WHERE holder."rowId" = p."headRowId")
    )
  )`;
}

// A plain substring of the Head or the Draft row id, so '_' and '%' are no wildcards; row ids are ASCII.
function searchMatches(search: string | undefined): Sql {
  if (search === undefined) {
    return sql`TRUE`;
  }

  const term = search.toLowerCase();

  return sql`(strpos(lower(p."rowId"), ${term}) > 0 OR strpos(lower(p."headRowId"), ${term}) > 0)`;
}

function rowsAfter(rowId: string | undefined): Sql {
  if (rowId === undefined) {
    return sql`TRUE`;
  }

  return sql`"rowId" COLLATE "C" > ${rowId}`;
}

function recentRowsAfter(key: RecentRowKey | undefined): Sql {
  if (key === undefined) {
    return sql`TRUE`;
  }

  return recentAfter(sql`${key.changedAt}::timestamp(3)`, sql`${key.rowId}`);
}

// The rows after a position of the recent order: after a row with a time, the older rows and every removed row; after a
// removed row, the removed rows of greater row ids.
function recentAfter(changedAt: Sql, rowId: Sql): Sql {
  return sql`(CASE WHEN ${changedAt} IS NULL
    THEN "changedAt" IS NULL AND "rowId" COLLATE "C" > ${rowId}
    ELSE "changedAt" IS NULL OR "changedAt" < ${changedAt}
      OR ("changedAt" = ${changedAt} AND "rowId" COLLATE "C" > ${rowId})
  END)`;
}

function changeTypeOf(structure: TableStructure): Sql {
  const modified = contentWithEffectDiffers(structure);

  return sql`CASE
    WHEN h."versionId" IS NULL THEN ${ChangeType.Added}::text
    WHEN d."versionId" IS NULL THEN ${ChangeType.Removed}::text
    WHEN ${IDS_DIFFER} AND (${modified}) THEN ${ChangeType.RenamedAndModified}::text
    WHEN ${IDS_DIFFER} THEN ${ChangeType.Renamed}::text
    ELSE ${ChangeType.Modified}::text
  END`;
}

// What a user sees of a row besides its id. The schema hash is technical, and a formula output that the structure keeps
// is computed from the row's values, so a difference in either alone has no effect.
function contentWithEffectDiffers(structure: TableStructure): Sql {
  return sql`(
    ${valuesDifferAt(structure, leafOwnersOf(structure))}
    OR ${columnDiffers('publishedAt')}
    OR ${columnDiffers('meta')}
  )`;
}

// A row on both sides with a row, field or rowColumns unit, shown or not: the units the catalogue builds for it.
function rowHasUnitsOfItsOwn(structure: TableStructure): Sql {
  const columns = UNIT_COLUMNS.filter(
    (column) => columnOwnerOf(column, structure).owner !== 'structure',
  );

  const differences = [
    IDS_DIFFER,
    valuesDifferAt(structure, leafOwnersOf(structure).filter(isOwnedByField)),
    ...columns.map(columnDiffers),
  ];

  return sql`(${join(differences, ' OR ')})`;
}

// Under an unchanged structure, equal stored hashes are trusted to mean equal data, as the plan's row change predicate
// trusts them, and only a pair whose hashes differ is compared leaf by leaf; under a changed structure the leaves are
// compared without the hash, as there.
function valuesDifferAt(
  structure: TableStructure,
  leaves: readonly LeafOwner[],
): Sql {
  if (leaves.length === 0) {
    return NOTHING_DIFFERS;
  }

  const leavesDiffer = join(leaves.map(leafDiffers), ' OR ');

  if (structure.differs) {
    return sql`(${leavesDiffer})`;
  }

  return sql`(${columnDiffers('hash')} AND (${leavesDiffer}))`;
}

function isOwnedByField(leaf: LeafOwner): boolean {
  return leaf.owner === 'field';
}
