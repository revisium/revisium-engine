import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  getArraySchema,
  getNumberSchema,
  getObjectSchema,
  getRefSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { DraftChangesRevisionSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { expectUnchangedDraftSnapshot } from '../support/snapshot-assertions';
import { givenReadingScenario } from './support/reading-scenario';
import { useReadingTestKit } from './support/reading-test-kit';

describe('Draft Changes reader: native computed projection', () => {
  const kit = useReadingTestKit();

  it('shows metadata and formula changes after a row rename without changing stored state', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { identity: '', label: '' },
      schema: metadataFormulaSchema('identity', SystemSchemaIds.RowId),
      rowId: 'old-id',
    });
    await scenario.renameDraftRow('new-id');
    const storedBeforeRead = await scenario.readSnapshot();

    const details = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
    });
    const computed = details.changes.filter(({ kind }) => kind === 'computed');

    expect(computed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selectable: false,
          effect: expect.objectContaining({
            path: '/identity',
            before: 'old-id',
            after: 'new-id',
          }),
        }),
        expect.objectContaining({
          selectable: false,
          effect: expect.objectContaining({
            path: '/label',
            before: 'old-id',
            after: 'new-id',
          }),
        }),
      ]),
    );
    expectUnchangedDraftSnapshot(
      storedBeforeRead,
      await scenario.readSnapshot(),
    );
  });

  it('projects original Head metadata through a renamed Draft schema pointer', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { identity: '', label: '' },
      schema: metadataFormulaSchema('identity', SystemSchemaIds.RowId),
      rowId: 'old-id',
    });
    await scenario.renameDraftRow('new-id');
    await scenario.patchDraftSchema([
      {
        op: 'move',
        from: '/properties/identity',
        path: '/properties/currentIdentity',
      },
      {
        op: 'replace',
        path: '/properties/label',
        value: formulaField('currentIdentity'),
      },
    ]);

    const details = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
    });
    const computed = details.changes.filter(({ kind }) => kind === 'computed');

    expect(computed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selectable: false,
          effect: expect.objectContaining({
            path: '/currentIdentity',
            before: 'old-id',
            after: 'new-id',
          }),
        }),
        expect.objectContaining({
          selectable: false,
          effect: expect.objectContaining({
            path: '/label',
            before: 'old-id',
            after: 'new-id',
          }),
        }),
      ]),
    );
  });

  it('counts computed-only metadata formula leaves as semantic changes', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { versionKey: '', label: '' },
      schema: metadataFormulaSchema('versionKey', SystemSchemaIds.RowVersionId),
    });
    const storedBeforeRead = await scenario.readSnapshot();
    const headVersionId = rowVersionId(
      storedBeforeRead.head,
      scenario.tableId,
      scenario.rowId,
    );
    const draftVersionId = rowVersionId(
      storedBeforeRead.draft,
      scenario.tableId,
      scenario.rowId,
    );

    const [summary, details] = await Promise.all([
      kit().changes.draftChanges(scenario.branch),
      kit().changes.draftRowChanges({
        ...scenario.branch,
        tableId: scenario.tableId,
        rowId: scenario.rowId,
      }),
    ]);

    const computed = details.changes.filter(({ kind }) => kind === 'computed');
    expect(computed).toHaveLength(2);
    expect(computed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'computed',
          selectable: false,
          effect: expect.objectContaining({
            path: '/versionKey',
            before: headVersionId,
            after: draftVersionId,
          }),
        }),
        expect.objectContaining({
          kind: 'computed',
          selectable: false,
          effect: expect.objectContaining({
            path: '/label',
            before: headVersionId,
            after: draftVersionId,
          }),
        }),
      ]),
    );
    expect(summary.isEmpty).toBe(false);
    expect(summary.counts.fields).toBe(2);
    expectUnchangedDraftSnapshot(
      storedBeforeRead,
      await scenario.readSnapshot(),
    );
  });

  it('keeps a canonical computed ref when native formula values are equal', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { total: 1 },
      draft: { total: 3 },
      schema: constantFormulaSchema(),
    });
    const catalogue = await scenario.readCatalogue();
    const canonical = catalogue.entries.find(
      ({ kind, path }) => kind === 'rowField' && path === '/total',
    );

    const details = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
    });
    const displayed = details.changes.find(
      ({ effect }) => effect?.path === '/total',
    );

    expect(canonical).toBeDefined();
    expect(displayed).toBeDefined();
    expect(displayed?.ref).toEqual(canonical?.ref);
    expect(displayed).toMatchObject({
      kind: 'computed',
      selectable: false,
      effect: { path: '/total', before: 2, after: 2 },
    });
  });

  it('preserves one selectable atomic array ref when native computed values also differ', async () => {
    const schema = arrayMetadataFormulaSchema();
    const scenario = await givenReadingScenario(kit(), {
      head: { items: [{ value: 1, versionKey: '', label: '' }] },
      draft: { items: [{ value: 2, versionKey: '', label: '' }] },
      schema,
    });
    const catalogue = await scenario.readCatalogue();
    const snapshot = await scenario.readSnapshot();
    const headVersionId = rowVersionId(
      snapshot.head,
      scenario.tableId,
      scenario.rowId,
    );
    const draftVersionId = rowVersionId(
      snapshot.draft,
      scenario.tableId,
      scenario.rowId,
    );

    const [summary, details] = await Promise.all([
      kit().changes.draftChanges(scenario.branch),
      kit().changes.draftRowChanges({
        ...scenario.branch,
        tableId: scenario.tableId,
        rowId: scenario.rowId,
      }),
    ]);
    const itemsLeaves = details.changes.filter(
      ({ effect }) => effect?.path === '/items',
    );
    const catalogueItems = catalogue.entries.filter(
      ({ kind, path }) => kind === 'rowField' && path === '/items',
    );

    expect(itemsLeaves).toHaveLength(1);
    expect(itemsLeaves[0]).toMatchObject({ kind: 'atomic', selectable: true });
    expect(catalogueItems).toHaveLength(1);
    expect(itemsLeaves[0]).toMatchObject({
      ref: catalogueItems[0]?.ref,
      effect: {
        path: '/items',
        before: [{ value: 1, versionKey: headVersionId, label: headVersionId }],
        after: [
          { value: 2, versionKey: draftVersionId, label: draftVersionId },
        ],
      },
    });
    expect(summary.counts.fields).toBe(1);
  });

  it('shows computed-only array metadata as one nonselectable atomic leaf', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { items: [{ value: 0, versionKey: '', label: '' }] },
      schema: arrayMetadataFormulaSchema(),
    });

    const [summary, details] = await Promise.all([
      kit().changes.draftChanges(scenario.branch),
      kit().changes.draftRowChanges({
        ...scenario.branch,
        tableId: scenario.tableId,
        rowId: scenario.rowId,
      }),
    ]);
    const itemsLeaves = details.changes.filter(
      ({ effect }) => effect?.path === '/items',
    );

    expect(itemsLeaves).toEqual([
      expect.objectContaining({ kind: 'computed', selectable: false }),
    ]);
    expect(summary.isEmpty).toBe(false);
    expect(summary.counts.fields).toBe(1);
  });

  it('keeps native file URLs inside the existing selectable file leaf', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { photo: uploadedFile('hash-head') },
      draft: { photo: uploadedFile('hash-draft') },
      schema: getObjectSchema({
        photo: getRefSchema(SystemSchemaIds.File),
      }),
    });
    const catalogue = await scenario.readCatalogue();
    const catalogueFile = catalogue.entries.find(
      ({ kind, path }) => kind === 'rowField' && path === '/photo',
    );

    const details = await kit().changes.draftRowChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
      rowId: scenario.rowId,
    });

    expect(details.changes).toHaveLength(1);
    expect(details.changes[0]).toMatchObject({
      kind: 'atomic',
      selectable: true,
      effect: expect.objectContaining({ path: '/photo' }),
      ref: catalogueFile?.ref,
    });
    expect(details.changes[0]?.effect).toMatchObject({
      before: { url: publicFileUrl('hash-head') },
      after: { url: publicFileUrl('hash-draft') },
    });
    expect(catalogueFile).toBeDefined();
  });
});

function rowVersionId(
  revision: DraftChangesRevisionSnapshot,
  tableId: string,
  rowId: string,
): string {
  const table = revision.tables.find(({ id }) => id === tableId);
  const row = table?.rows.find(({ id }) => id === rowId);
  if (!row) {
    throw new Error(`Expected persisted row '${tableId}/${rowId}'.`);
  }
  return row.versionId;
}

function metadataFormulaSchema(
  field: string,
  ref: SystemSchemaIds,
): JsonSchema {
  return getObjectSchema({
    [field]: getRefSchema(ref),
    label: formulaField(field),
  });
}

function formulaField(expression: string) {
  return {
    ...getStringSchema(),
    readOnly: true,
    'x-formula': { version: 1 as const, expression },
  };
}

function arrayMetadataFormulaSchema(): JsonSchema {
  return getObjectSchema({
    items: getArraySchema(
      getObjectSchema({
        value: getNumberSchema(),
        versionKey: getRefSchema(SystemSchemaIds.RowVersionId),
        label: {
          ...getStringSchema(),
          readOnly: true,
          'x-formula': { version: 1, expression: 'versionKey' },
        },
      }),
    ),
  });
}

function constantFormulaSchema(): JsonSchema {
  return getObjectSchema({
    total: {
      ...getNumberSchema(),
      readOnly: true,
      'x-formula': { version: 1, expression: '1 + 1' },
    },
  });
}

function uploadedFile(hash: string) {
  return {
    status: 'uploaded',
    fileId: 'stored-file',
    url: '',
    fileName: 'photo.png',
    hash,
    extension: 'png',
    mimeType: 'image/png',
    size: 1,
    width: 1,
    height: 1,
  };
}

function publicFileUrl(hash: string): string {
  return ['http:', '', 'test-files', hash].join('/');
}
