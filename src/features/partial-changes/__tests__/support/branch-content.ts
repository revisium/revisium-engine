import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue, Row } from 'src/engine-prisma-types';
import type { ChangesScenario } from './changes-scenario';

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

export interface TableContent {
  readonly id: string;
  readonly system: boolean;
  readonly readonly: boolean;
  readonly rows: readonly JsonValue[];
}

export interface BranchContent {
  readonly head: readonly TableContent[];
  readonly draft: readonly TableContent[];
  readonly draftHasChanges: boolean;
}

// Twin branches differ only in when they were built: migration ids, schema history dates and publishedAt.
export async function branchContentOf(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
): Promise<BranchContent> {
  return {
    head: await revisionContentOf(kit, await draft.revisionId('head')),
    draft: await revisionContentOf(kit, await draft.revisionId('draft')),
    draftHasChanges: await draft.hasChanges(),
  };
}

async function revisionContentOf(
  kit: PartialChangesTestKit,
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
