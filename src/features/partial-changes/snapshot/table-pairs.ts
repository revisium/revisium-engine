import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import type {
  RevisionRows,
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { HistoryPatches } from 'src/features/share/queries/impl';

export interface StoredTable {
  readonly versionId: string;
  readonly createdId: string;
  readonly id: string;
  readonly readonly: boolean;
  readonly system: boolean;
}

export interface RevisionTables {
  readonly head: readonly StoredTable[];
  readonly draft: readonly StoredTable[];
}

export function pairUserTablesByIdentity(
  tables: RevisionTables,
  schemaRows: RevisionRows,
): TablePair[] {
  const head = userTableVersions(tables.head, schemaRows.head);
  const draft = userTableVersions(tables.draft, schemaRows.draft);
  const identities = new Set([...head.keys(), ...draft.keys()]);

  return [...identities].map((identity) => ({
    identity,
    head: head.get(identity),
    draft: draft.get(identity),
  }));
}

function userTableVersions(
  tables: readonly StoredTable[],
  schemaRows: readonly Row[],
): Map<string, TableVersion> {
  const schemaRowsByTableId = new Map(schemaRows.map((row) => [row.id, row]));

  return new Map(
    tables
      .filter((table) => !table.system)
      .map((table) => [
        table.createdId,
        withSchema(table, schemaRowsByTableId.get(table.id)),
      ]),
  );
}

function withSchema(
  table: StoredTable,
  schemaRow: Row | undefined,
): TableVersion {
  if (!schemaRow) {
    throw new Error(`Table "${table.id}" has no schema row`);
  }

  return {
    versionId: table.versionId,
    createdId: table.createdId,
    id: table.id,
    readonly: table.readonly,
    schema: schemaRow.data as unknown as JsonSchema,
    history: schemaRow.meta as unknown as HistoryPatches[],
  };
}
