import type { BranchScenarioTestKit } from 'src/__tests__/kit/create-branch-scenario-test-kit';
import { type JsonValue, type Row, sql } from 'src/engine-prisma-types';
import type { BranchScenario } from './branch-scenario';

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

export interface TableContent {
  readonly id: string;
  readonly system: boolean;
  readonly readonly: boolean;
  readonly rows: readonly JsonValue[];
}

export interface RevisionContents {
  readonly revision: unknown;
  readonly tableVersions: string;
  readonly rowLinks: number;
  readonly rows: string;
  readonly migrationRecords: number;
}

export interface BranchContent {
  readonly head: readonly TableContent[];
  readonly draft: readonly TableContent[];
  readonly draftHasChanges: boolean;
}

// Twin branches differ only in when they were built: migration ids, schema history dates and publishedAt.
export async function branchContentOf(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
): Promise<BranchContent> {
  return {
    head: await revisionContentOf(kit, await draft.revisionId('head')),
    draft: await revisionContentOf(kit, await draft.revisionId('draft')),
    draftHasChanges: await draft.hasChanges(),
  };
}

export function branchContentsOf(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
): Promise<RevisionContents[]> {
  return kit.prisma.$queryRaw<RevisionContents[]>(sql`
    SELECT to_jsonb(rev) AS "revision",
           (SELECT md5(coalesce(string_agg(to_jsonb(t)::text, ',' ORDER BY t."versionId"), ''))
              FROM "_RevisionToTable" rt JOIN "Table" t ON t."versionId" = rt."B"
             WHERE rt."A" = rev."id") AS "tableVersions",
           (SELECT count(*) FROM "_RevisionToTable" rt
              JOIN "_RowToTable" rr ON rr."B" = rt."B"
             WHERE rt."A" = rev."id")::int AS "rowLinks",
           (SELECT md5(coalesce(string_agg(to_jsonb(r)::text, ',' ORDER BY rr."B", r."versionId"), ''))
              FROM "_RevisionToTable" rt
              JOIN "_RowToTable" rr ON rr."B" = rt."B"
              JOIN "Row" r ON r."versionId" = rr."A"
             WHERE rt."A" = rev."id") AS "rows",
           (SELECT count(*) FROM "TableMigration" tm
             WHERE tm."revisionId" = rev."id")::int AS "migrationRecords"
    FROM "Revision" rev
    WHERE rev."branchId" = ${draft.branchId}
    ORDER BY rev."id"
  `);
}

async function revisionContentOf(
  kit: BranchScenarioTestKit,
  revisionId: string,
): Promise<TableContent[]> {
  const tables = await kit.prisma.table.findMany({
    where: { revisions: { some: { id: revisionId } } },
    select: {
      id: true,
      system: true,
      readonly: true,
      rows: { orderBy: { id: 'asc' } },
    },
    orderBy: { id: 'asc' },
  });

  return tables.map((table) => ({
    id: table.id,
    system: table.system,
    readonly: table.readonly,
    rows: table.rows.map(rowContentOf),
  }));
}

function rowContentOf(row: Row): JsonValue {
  return withoutTimestamps({
    id: row.id,
    data: row.data,
    meta: row.meta,
    schemaHash: row.schemaHash,
    readonly: row.readonly,
  });
}

function withoutTimestamps(content: JsonValue): JsonValue {
  return JSON.parse(
    JSON.stringify(content).replace(ISO_TIMESTAMP, 'timestamp'),
  ) as JsonValue;
}
