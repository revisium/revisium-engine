import {
  createJsonSchemaStore,
  getForeignKeyPatchesFromSchema,
} from '@revisium/schema-toolkit/lib';
import type {
  JsonPatch,
  JsonSchema,
  Migration,
  UpdateMigration,
} from '@revisium/schema-toolkit/types';
import {
  analyzeTableStructure,
  type TableStructure,
} from 'src/features/partial-changes/structure/table-structure';
import {
  refs,
  update,
  validator,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import type { HistoryPatches } from 'src/features/share/queries/impl';

const TABLE_ID = 'products';
const UNCHECKED_HASH = '';
const HISTORY_DATE = '2026-10-31T00:00:00.000Z';

const nativeSchemaRules = new NativeSchemaRules(refs, validator);

export interface StructureScenario {
  readonly head: JsonSchema;
  readonly replayedHead?: JsonSchema;
  readonly draft: JsonSchema;
  readonly draftTableId?: string;
  readonly pending?: readonly Migration[];
  readonly headHistory?: readonly JsonPatch[][];
  readonly draftHistory?: readonly JsonPatch[][];
  readonly headTables?: Readonly<Record<string, string>>;
  readonly draftTables?: Readonly<Record<string, string>>;
}

export function analyzeStructure(scenario: StructureScenario): TableStructure {
  const pending = scenario.pending ?? [];
  const headHistory = scenario.headHistory ?? [createdWith(scenario.head)];
  const draftHistory = scenario.draftHistory ?? [
    ...headHistory,
    ...pending.flatMap(patchesOf),
  ];

  return analyzeTableStructure(
    {
      head: {
        tableId: TABLE_ID,
        schema: scenario.head,
        history: headHistory.map(historyEntry),
        tableIdentities: identitiesOf(scenario.headTables),
      },
      draft: {
        tableId: scenario.draftTableId ?? TABLE_ID,
        schema: scenario.draft,
        history: draftHistory.map(historyEntry),
        tableIdentities: identitiesOf(scenario.draftTables),
      },
      pendingMigrations: pending,
      replayedHeadSchema: scenario.replayedHead,
    },
    nativeSchemaRules,
  );
}

export function pendingUpdate(...patches: JsonPatch[]): UpdateMigration {
  return update(TABLE_ID, patches);
}

export function createdWith(schema: JsonSchema): JsonPatch[] {
  return [{ op: 'add', path: '', value: schema }];
}

export function foreignKeyRewrite(
  schema: JsonSchema,
  tableId: string,
  nextTableId: string,
): JsonPatch[] {
  return getForeignKeyPatchesFromSchema(createJsonSchemaStore(schema, refs), {
    tableId,
    nextTableId,
  });
}

export function unchangedPointersOf(structure: TableStructure): string[] {
  return structure.unchangedLeaves.map((leaf) => leaf.pointer.toString());
}

export function changedPointersOf(structure: TableStructure): string[] {
  return structure.changedPointers.map((pointer) => pointer.toString());
}

function patchesOf(migration: Migration): JsonPatch[][] {
  if (migration.changeType !== 'update') {
    return [];
  }

  return [migration.patches];
}

function historyEntry(patches: JsonPatch[]): HistoryPatches {
  return { patches, hash: UNCHECKED_HASH, date: HISTORY_DATE };
}

function identitiesOf(
  tables: Readonly<Record<string, string>> = {},
): ReadonlyMap<string, string> {
  return new Map(Object.entries(tables));
}
