import { pluginRefs } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import {
  givenSchemaPatchGroups,
  givenSchemaProjection,
  numberField,
  rowInput,
  stringField,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';
import {
  givenTableIdSwapCandidate,
  schemaWith,
} from 'src/features/draft-changes/__tests__/candidates/support/candidate-scenario';
import {
  project,
  requiredProjected,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-results';
import { validateSchemaHistory } from 'src/features/draft-changes/schema/schema-history';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/snapshot/fingerprint';

const primaryCreatedId = 'stable-products';
const secondaryCreatedId = 'stable-secondary-products';
const tableRetargets = [
  {
    targetTableCreatedId: primaryCreatedId,
    fromTableId: 'products',
    toTableId: 'secondary-products',
  },
  {
    targetTableCreatedId: secondaryCreatedId,
    fromTableId: 'secondary-products',
    toTableId: 'products',
  },
];

describe('schema foreign-key retarget provenance', () => {
  it('keeps the selected Draft FK binding when committing a table-name swap', async () => {
    const { snapshot, effects } = await givenSwappedSchemaEffect();

    const result = await project({
      snapshot,
      tableCreatedId: primaryCreatedId,
      operation: 'commit',
      effects,
      foreignKeyRetargets: tableRetargets,
    });

    expect(result).toMatchObject({ status: 'projected' });
    if (result.status !== 'projected') {
      return;
    }
    expect(result.head.schema).toMatchObject({
      properties: {
        link: {
          foreignKey: 'secondary-products',
          description: 'Draft independent target',
        },
      },
    });
    expect(result.draft.schema).toEqual(result.head.schema);
    expect(result.head.history).toEqual(
      result.draft.history.slice(0, result.head.history.length),
    );
    expect(
      validateSchemaHistory(
        result.head.schema,
        result.head.history,
        pluginRefs,
      ),
    ).toBeUndefined();
    expect(
      validateSchemaHistory(
        result.draft.schema,
        result.draft.history,
        pluginRefs,
      ),
    ).toBeUndefined();
  });

  it('restores the Head FK binding when discarding the table-name swap effect', async () => {
    const { snapshot, effects, headSchema } = await givenSwappedSchemaEffect();

    const result = requiredProjected(
      await project({
        snapshot,
        tableCreatedId: primaryCreatedId,
        operation: 'discard',
        effects,
        foreignKeyRetargets: tableRetargets,
      }),
    );

    expect(result.head.schema).toEqual(headSchema);
    expect(result.draft.schema).toEqual(headSchema);
    expect(result.draft.schema).toMatchObject({
      properties: { link: { foreignKey: 'secondary-products' } },
    });
    expect(result.head.history).toEqual(
      result.draft.history.slice(0, result.head.history.length),
    );
    expect(
      validateSchemaHistory(
        result.head.schema,
        result.head.history,
        pluginRefs,
      ),
    ).toBeUndefined();
    expect(
      validateSchemaHistory(
        result.draft.schema,
        result.draft.history,
        pluginRefs,
      ),
    ).toBeUndefined();
  });

  it('retargets a selected historical FK replacement by its original binding', async () => {
    const projection = givenHistoricalDescriptionBeforeRename();

    const result = requiredProjected(
      await project({
        ...projection,
        operation: 'commit',
        effects: [{ historyIndex: 1, patchIndex: 0 }],
        foreignKeyRetargets: [
          {
            targetTableCreatedId: primaryCreatedId,
            fromTableId: 'products',
            toTableId: 'renamed-products',
          },
        ],
      }),
    );

    expect(result.head.schema).toMatchObject({
      properties: {
        link: { foreignKey: 'renamed-products', description: 'Edited' },
      },
    });
    expect(result.draft.schema).toEqual(result.head.schema);
    expect(result.selectedEffects).toEqual([
      { historyIndex: 1, patchIndex: 0 },
    ]);
    expect(result.head.history).toEqual(
      result.draft.history.slice(0, result.head.history.length),
    );
    expect(
      validateSchemaHistory(
        result.head.schema,
        result.head.history,
        pluginRefs,
      ),
    ).toBeUndefined();
    expect(
      validateSchemaHistory(
        result.draft.schema,
        result.draft.history,
        pluginRefs,
      ),
    ).toBeUndefined();
  });

  it('keeps a selected unchanged FK bound to its Head target across a later name swap', async () => {
    const { snapshot, effects } = await givenHistoricalDescriptionBeforeSwap();

    const projection = await project({
      snapshot,
      tableCreatedId: primaryCreatedId,
      operation: 'commit',
      effects,
      foreignKeyRetargets: tableRetargets,
    });
    if (projection.status !== 'projected') {
      throw new Error(JSON.stringify(projection.blockers));
    }
    const result = projection;

    expect(result.head.schema).toMatchObject({
      properties: {
        link: { foreignKey: 'secondary-products', description: 'Edited' },
      },
    });
    expect(result.draft.schema).toEqual(result.head.schema);
    expect(result.selectedEffects).toEqual([
      { historyIndex: 1, patchIndex: 0 },
    ]);
    expect(result.head.history).toEqual(
      result.draft.history.slice(0, result.head.history.length),
    );
    expect(
      validateSchemaHistory(
        result.head.schema,
        result.head.history,
        pluginRefs,
      ),
    ).toBeUndefined();
    expect(
      validateSchemaHistory(
        result.draft.schema,
        result.draft.history,
        pluginRefs,
      ),
    ).toBeUndefined();
  });

  it('keeps a retained historical FK bound to Head when discarding later renames', async () => {
    const { snapshot } = await givenHistoricalDescriptionBeforeSwap();
    const result = requiredProjected(
      await project({
        snapshot,
        tableCreatedId: primaryCreatedId,
        operation: 'discard',
        effects: [
          { historyIndex: 2, patchIndex: 0 },
          { historyIndex: 3, patchIndex: 0 },
        ],
        foreignKeyRetargets: tableRetargets,
      }),
    );

    expect(result.head.schema).toMatchObject({
      properties: { link: { foreignKey: 'products', description: 'Head' } },
    });
    expect(result.draft.schema).toMatchObject({
      properties: { link: { foreignKey: 'products', description: 'Edited' } },
    });
    expect(result.head.history).toEqual(
      result.draft.history.slice(0, result.head.history.length),
    );
    expect(
      validateSchemaHistory(
        result.draft.schema,
        result.draft.history,
        pluginRefs,
      ),
    ).toBeUndefined();
  });
});

function givenHistoricalDescriptionBeforeRename() {
  const headLink = {
    ...stringField(),
    foreignKey: 'products',
    description: 'Head',
  };
  const editedLink = { ...headLink, description: 'Edited' };
  const renamedLink = { ...editedLink, foreignKey: 'renamed-products' };
  const headSchema = schemaWith({ link: headLink });
  const history = givenSchemaPatchGroups(headSchema, [
    [
      {
        op: 'replace',
        path: '/properties/link',
        value: editedLink,
      },
    ],
    [
      {
        op: 'replace',
        path: '/properties/link',
        value: renamedLink,
      },
    ],
  ]);
  return givenSchemaProjection({
    tableCreatedId: primaryCreatedId,
    headTableId: 'products',
    draftTableId: 'renamed-products',
    headSchema,
    draftSchema: history.terminalSchema,
    pending: history.steps,
    headRows: [rowInput('product', { link: 'product' })],
    draftRows: [rowInput('product', { link: 'product' })],
  });
}

async function givenHistoricalDescriptionBeforeSwap() {
  const base = await givenTableIdSwapCandidate('commit');
  const snapshot = structuredClone(base.snapshot);
  const headLink = {
    ...stringField(),
    foreignKey: 'products',
    description: 'Head',
  };
  const editedLink = { ...headLink, description: 'Edited' };
  const movedPrimaryLink = { ...editedLink, foreignKey: 'temporary-products' };
  const swappedPrimaryLink = {
    ...editedLink,
    foreignKey: 'secondary-products',
  };
  const headSchema = schemaWith({ link: headLink });
  const history = givenSchemaPatchGroups(headSchema, [
    [{ op: 'replace', path: '/properties/link', value: editedLink }],
    [{ op: 'replace', path: '/properties/link', value: movedPrimaryLink }],
    [{ op: 'replace', path: '/properties/link', value: swappedPrimaryLink }],
  ]);
  const primary = givenSchemaProjection({
    tableCreatedId: primaryCreatedId,
    headTableId: 'products',
    draftTableId: 'secondary-products',
    headSchema,
    draftSchema: history.terminalSchema,
    pending: history.steps,
    headRows: [rowInput('product', { link: 'product' })],
    draftRows: [rowInput('product', { link: 'product' })],
  });
  replaceTable(snapshot.head, primary.snapshot.head, primaryCreatedId);
  replaceTable(snapshot.draft, primary.snapshot.draft, primaryCreatedId);
  setSecondaryTargetRow(snapshot.head);
  setSecondaryTargetRow(snapshot.draft);
  snapshot.fingerprint = fingerprintDraftChangesSnapshot({
    branch: snapshot.branch,
    head: snapshot.head,
    draft: snapshot.draft,
  });
  return {
    snapshot,
    effects: [{ historyIndex: 1, patchIndex: 0 }],
  };
}

async function givenSwappedSchemaEffect(): Promise<{
  snapshot: DraftChangesSnapshot;
  effects: Array<{ historyIndex: number; patchIndex: number }>;
  headSchema: JsonSchema;
}> {
  const { snapshot } = await givenSwappedSchemaEffectSnapshot();
  const headHistory = schemaHistory(snapshot, 'head', primaryCreatedId);
  const draftHistory = schemaHistory(snapshot, 'draft', primaryCreatedId);
  const headSchema = schemaForTable(snapshot, 'head', primaryCreatedId);

  if (draftHistory.length !== headHistory.length + 1) {
    throw new Error('Expected one selected independent Draft schema effect.');
  }

  return {
    snapshot,
    effects: [{ historyIndex: headHistory.length, patchIndex: 0 }],
    headSchema,
  };
}

async function givenSwappedSchemaEffectSnapshot(): Promise<{
  snapshot: DraftChangesSnapshot;
}> {
  const base = await givenTableIdSwapCandidate('commit');
  const snapshot = structuredClone(base.snapshot);
  const headSchema = schemaWith({
    title: stringField(),
    price: numberField(),
    link: {
      type: 'string',
      default: '',
      foreignKey: 'secondary-products',
      description: 'Head link',
    },
  });
  const draftLink = {
    type: 'string' as const,
    default: '',
    foreignKey: 'secondary-products',
    description: 'Draft independent target',
  };
  const draftSchema = schemaWith({
    title: stringField(),
    price: numberField(),
    link: draftLink,
  });
  const history = givenSchemaPatchGroups(headSchema, [
    [
      {
        op: 'replace',
        path: '/properties/link',
        value: draftLink,
      },
    ],
  ]);
  const primary = givenSchemaProjection({
    tableCreatedId: primaryCreatedId,
    headTableId: 'products',
    draftTableId: 'secondary-products',
    headSchema,
    draftSchema,
    pending: history.steps,
    headRows: [
      rowInput('source-row', { title: 'Head', price: 1, link: 'target-row' }),
    ],
    draftRows: [
      rowInput('source-row', { title: 'Draft', price: 2, link: 'source-row' }),
    ],
  });
  replaceTable(snapshot.head, primary.snapshot.head, primaryCreatedId);
  replaceTable(snapshot.draft, primary.snapshot.draft, primaryCreatedId);
  setSecondaryTargetRow(snapshot.head);
  setSecondaryTargetRow(snapshot.draft);
  snapshot.fingerprint = fingerprintDraftChangesSnapshot({
    branch: snapshot.branch,
    head: snapshot.head,
    draft: snapshot.draft,
  });
  return { snapshot };
}

function replaceTable(
  targetState: DraftChangesSnapshot['head'],
  sourceState: DraftChangesSnapshot['head'],
  tableCreatedId: string,
): void {
  const targetIndex = targetState.tables.findIndex(
    (table) => table.createdId === tableCreatedId,
  );
  const sourceTable = sourceState.tables.find(
    (table) => table.createdId === tableCreatedId,
  );
  const targetSchemaTable = targetState.tables.find(
    (table) => table.id === SystemTables.Schema,
  );
  const sourceSchemaTable = sourceState.tables.find(
    (table) => table.id === SystemTables.Schema,
  );
  const targetSchema = targetSchemaTable?.rows.find(
    (row) => row.createdId === 'schema-products-created',
  );
  const sourceSchema = sourceSchemaTable?.rows.find(
    (row) => row.createdId === 'schema-products-created',
  );
  if (
    targetIndex < 0 ||
    !sourceTable ||
    !targetSchemaTable ||
    !sourceSchemaTable ||
    !targetSchema ||
    !sourceSchema
  ) {
    throw new Error(`Expected table identity '${tableCreatedId}'.`);
  }
  targetState.tables[targetIndex] = structuredClone(sourceTable);
  targetSchemaTable.rows[targetSchemaTable.rows.indexOf(targetSchema)] =
    structuredClone(sourceSchema);
}

function setSecondaryTargetRow(state: DraftChangesSnapshot['head']): void {
  const table = state.tables.find(
    (candidate) => candidate.createdId === secondaryCreatedId,
  );
  const primary = state.tables.find(
    (candidate) => candidate.createdId === primaryCreatedId,
  );
  const rowTemplate = primary?.rows[0];
  if (!table || !rowTemplate) {
    throw new Error('Expected the swapped target table and row template.');
  }
  const data = { title: 'Target', price: 3 };
  const targetRow = {
    ...structuredClone(rowTemplate),
    id: 'target-row',
    createdId: 'target-row',
    data,
    hash: objectHash(data),
  };
  table.rows = [targetRow];
}

function schemaHistory(
  snapshot: DraftChangesSnapshot,
  role: 'head' | 'draft',
  tableCreatedId: string,
): HistoryPatches[] {
  const revision = snapshot[role];
  const table = revision.tables.find(
    (candidate) => candidate.createdId === tableCreatedId,
  );
  const schemaTable = revision.tables.find(
    (candidate) => candidate.id === SystemTables.Schema,
  );
  const schemaRow = schemaTable?.rows.find(
    (candidate) => candidate.id === table?.id,
  );
  if (!schemaRow || !Array.isArray(schemaRow.meta)) {
    throw new Error(`Expected ${role} schema history for '${tableCreatedId}'.`);
  }
  return schemaRow.meta as unknown as HistoryPatches[];
}

function schemaForTable(
  snapshot: DraftChangesSnapshot,
  role: 'head' | 'draft',
  tableCreatedId: string,
): JsonSchema {
  const revision = snapshot[role];
  const table = revision.tables.find(
    (candidate) => candidate.createdId === tableCreatedId,
  );
  const schemaTable = revision.tables.find(
    (candidate) => candidate.id === SystemTables.Schema,
  );
  const schemaRow = schemaTable?.rows.find(
    (candidate) => candidate.id === table?.id,
  );
  if (!schemaRow) {
    throw new Error(`Expected ${role} schema for '${tableCreatedId}'.`);
  }
  return schemaRow.data as JsonSchema;
}
