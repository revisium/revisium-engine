import { RevisiumValidator } from '@revisium/schema-toolkit/lib';
import type { JsonSchema, JsonValue } from '@revisium/schema-toolkit/types';
import type {
  DraftChangesRevisionSnapshot,
  DraftChangesSnapshot,
} from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { SchemaProjectionBlocker } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';
import { SystemTables } from 'src/features/share/system-tables.consts';

type RevisionTable = DraftChangesRevisionSnapshot['tables'][number];
type RevisionRow = RevisionTable['rows'][number];

export interface RevisionSchemaState {
  table: RevisionTable;
  schemaRowCreatedId: string;
  schema: JsonSchema;
  history: HistoryPatches[];
  rows: Array<{ createdId: string; data: JsonValue }>;
}

export type SchemaSnapshotResult =
  | {
      state: {
        head: RevisionSchemaState;
        draft: RevisionSchemaState;
      };
    }
  | { blocker: SchemaProjectionBlocker };

export function readSchemaStates(
  snapshot: DraftChangesSnapshot,
  tableCreatedId: string,
): SchemaSnapshotResult {
  const head = readRevisionState(snapshot.head, tableCreatedId);
  if ('blocker' in head) {
    return head;
  }
  const draft = readRevisionState(snapshot.draft, tableCreatedId);
  if ('blocker' in draft) {
    return draft;
  }
  if (head.state.schemaRowCreatedId !== draft.state.schemaRowCreatedId) {
    return {
      blocker: {
        code: 'SCHEMA_IDENTITY_MISSING',
        message: 'Head and Draft schema rows do not share a stable createdId.',
      },
    };
  }
  return { state: { head: head.state, draft: draft.state } };
}

function readRevisionState(
  revision: DraftChangesRevisionSnapshot,
  tableCreatedId: string,
): { state: RevisionSchemaState } | { blocker: SchemaProjectionBlocker } {
  const matches = revision.tables.filter(
    (table) => !table.system && table.createdId === tableCreatedId,
  );
  if (matches.length !== 1) {
    return {
      blocker: {
        code: 'TABLE_COUNTERPART_MISSING',
        message: `Expected one non-system table with createdId '${tableCreatedId}' in revision '${revision.id}'.`,
      },
    };
  }
  const [table] = matches;
  if (!table) {
    return {
      blocker: {
        code: 'TABLE_COUNTERPART_MISSING',
        message: `Revision '${revision.id}' has no matching table.`,
      },
    };
  }
  return readTableState(revision, table);
}

function readTableState(
  revision: DraftChangesRevisionSnapshot,
  table: RevisionTable,
): { state: RevisionSchemaState } | { blocker: SchemaProjectionBlocker } {
  const schemaTables = revision.tables.filter(
    ({ id }) => id === SystemTables.Schema,
  );
  if (schemaTables.length === 0) {
    return {
      blocker: {
        code: 'SCHEMA_IDENTITY_MISSING',
        message: `Revision '${revision.id}' has no schema table.`,
      },
    };
  }
  if (schemaTables.length !== 1) {
    return {
      blocker: {
        code: 'SCHEMA_IDENTITY_AMBIGUOUS',
        message: `Revision '${revision.id}' has multiple schema tables.`,
      },
    };
  }
  const schemaTable = schemaTables[0];
  if (!schemaTable) {
    return {
      blocker: {
        code: 'SCHEMA_IDENTITY_MISSING',
        message: `Revision '${revision.id}' has no schema table.`,
      },
    };
  }

  const schemaRows = schemaTable.rows.filter(({ id }) => id === table.id);
  if (schemaRows.length === 0) {
    return {
      blocker: {
        code: 'SCHEMA_IDENTITY_MISSING',
        message: `No schema row identifies table '${table.id}' in revision '${revision.id}'.`,
      },
    };
  }
  if (schemaRows.length !== 1) {
    return {
      blocker: {
        code: 'SCHEMA_IDENTITY_AMBIGUOUS',
        message: `More than one schema row identifies table '${table.id}' in revision '${revision.id}'.`,
      },
    };
  }
  const [schemaRow] = schemaRows;
  if (!schemaRow) {
    return {
      blocker: {
        code: 'SCHEMA_IDENTITY_MISSING',
        message: `No schema row identifies table '${table.id}' in revision '${revision.id}'.`,
      },
    };
  }

  const history = schemaHistory(schemaRow);
  if ('blocker' in history) {
    return history;
  }

  return {
    state: {
      table,
      schemaRowCreatedId: schemaRow.createdId,
      schema: schemaRow.data as JsonSchema,
      history,
      rows: table.rows.map(({ createdId, data }) => ({
        createdId,
        data: data as JsonValue,
      })),
    },
  };
}

function schemaHistory(
  row: RevisionRow,
): HistoryPatches[] | { blocker: SchemaProjectionBlocker } {
  const validator = new RevisiumValidator();
  if (Array.isArray(row.meta) && row.meta.length === 0) {
    return {
      blocker: {
        code: 'SCHEMA_HISTORY_MISSING',
        message: 'Schema row metadata has no initial schema history entry.',
      },
    };
  }
  if (!Array.isArray(row.meta) || !validator.validateHistoryPatches(row.meta)) {
    return {
      blocker: {
        code: 'SCHEMA_HISTORY_INVALID',
        message: 'Schema row metadata is not a valid schema history.',
      },
    };
  }
  return row.meta as HistoryPatches[];
}
