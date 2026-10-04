import {
  changeEntry,
  ref,
  requiredEntryRef,
  requiredResolvedRowField,
  resolveSelection,
  selectionCatalogue,
} from './support/selection-fixture';
import {
  buildCatalogue,
  givenCatalogueScenario,
} from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';

const changedScopes = [
  { name: 'fingerprint', changes: { fingerprint: 'fingerprint-b' } },
  { name: 'branch', changes: { branchId: 'branch-b' } },
  { name: 'head revision role', changes: { headRevisionId: 'head-b' } },
  { name: 'Draft revision role', changes: { draftRevisionId: 'draft-b' } },
] as const;

describe('draft changes selection references and identities', () => {
  it.each(changedScopes)(
    'rejects a real reference when the current catalogue has a different $name scope',
    async ({ changes }) => {
      const options = {
        headRows: [{ createdId: 'row-product', data: { title: 'Head' } }],
        draftRows: [{ createdId: 'row-product', data: { title: 'Draft' } }],
      };
      const oldCatalogue = await buildCatalogue(
        await givenCatalogueScenario(options),
      );
      const currentCatalogue = await buildCatalogue(
        await givenCatalogueScenario({ ...options, ...scopeOptions(changes) }),
      );
      const result = await resolveSelection(currentCatalogue, {
        include: [{ kind: 'change', ref: requiredEntryRef(oldCatalogue) }],
      });

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [{ code: 'STALE_CATALOGUE' }],
      });
    },
  );

  it('distinguishes an unknown ref from a stale scoped ref', async () => {
    const catalogue = selectionCatalogue();
    const result = await resolveSelection(catalogue, {
      include: [{ kind: 'change', ref: ref('unrecognized-garbage') }],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'UNKNOWN_REFERENCE' }],
    });
  });

  it('treats malformed versioned refs as unknown references', async () => {
    const catalogue = selectionCatalogue();

    const result = await resolveSelection(catalogue, {
      include: [{ kind: 'change', ref: ref('dc1.bad-shape') }],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'UNKNOWN_REFERENCE' }],
    });
  });

  it('retains a valid opaque ref shape when serializing a catalogue change', async () => {
    const catalogue = await buildCatalogue(
      await givenCatalogueScenario({
        headRows: [{ createdId: 'row-product', data: { title: 'Head' } }],
        draftRows: [{ createdId: 'row-product', data: { title: 'Draft' } }],
      }),
    );
    const entry = catalogue.entries[0];

    expect(entry?.ref.value).toMatch(
      /^dc1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/,
    );
  });

  it('blocks an unknown public table or row target', async () => {
    const catalogue = selectionCatalogue();
    const tableResult = await resolveSelection(catalogue, {
      include: [{ kind: 'table', tableId: 'missing' }],
    });
    const rowResult = await resolveSelection(catalogue, {
      include: [{ kind: 'rows', tableId: 'products', rowIds: ['missing'] }],
    });

    expect(tableResult).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'UNKNOWN_TARGET' }],
    });
    expect(rowResult).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'UNKNOWN_TARGET' }],
    });
  });

  it('keeps exclusions scoped to an exact identity when a schema path is reused', async () => {
    const removed = changeEntry(
      'schemaField',
      'old-field',
      {
        kind: 'schemaField',
        tableCreatedId: 'table-created',
        tableId: 'products',
        path: '/properties/title',
      },
      { classification: 'deleted', path: '/properties/title' },
    );
    const recreated = changeEntry(
      'schemaField',
      'new-field',
      {
        kind: 'schemaField',
        tableCreatedId: 'table-created',
        tableId: 'products',
        path: '/properties/title',
      },
      { classification: 'created', path: '/properties/title' },
    );
    const result = await resolveSelection(
      selectionCatalogue({ entries: [removed, recreated] }),
      {
        include: [{ kind: 'all' }],
        exclude: [{ kind: 'change', ref: removed.ref }],
      },
    );

    expect(result).toMatchObject({
      status: 'resolved',
      selected: [{ ref: recreated.ref }],
      excluded: [{ ref: removed.ref }],
      deniedTargets: [{ kind: 'change', ref: removed.ref }],
    });
  });

  it('detaches resolved entries from the input catalogue', async () => {
    const entry = changeEntry(
      'rowField',
      'detached',
      {
        kind: 'rowField',
        tableCreatedId: 'table-created',
        rowCreatedId: 'row-created',
        tableId: 'products',
        rowId: 'product-1',
        path: '/title',
      },
      { path: '/title' },
    );
    const catalogue = selectionCatalogue({ entries: [entry] });
    const result = await resolveSelection(catalogue, {
      include: [{ kind: 'change', ref: entry.ref }],
    });
    requiredResolvedRowField(result).path = '/mutated';

    expect(catalogue.entries[0]?.target).toMatchObject({ path: '/title' });
  });

  it('blocks a table ID selector made ambiguous by an ID swap', async () => {
    const catalogue = selectionCatalogue({
      identityBindings: [
        {
          kind: 'table',
          tableCreatedId: 'stable-a',
          entityCreatedId: 'stable-a',
          headIds: ['one'],
          draftIds: ['two'],
        },
        {
          kind: 'table',
          tableCreatedId: 'stable-b',
          entityCreatedId: 'stable-b',
          headIds: ['two'],
          draftIds: ['one'],
        },
      ],
    });

    const result = await resolveSelection(catalogue, {
      include: [{ kind: 'table', tableId: 'one' }],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'AMBIGUOUS_IDENTITY' }],
    });
  });

  it('blocks a row ID selector made ambiguous by a row ID swap', async () => {
    const catalogue = selectionCatalogue({
      identityBindings: [
        {
          kind: 'table',
          tableCreatedId: 'stable-table',
          entityCreatedId: 'stable-table',
          headIds: ['products'],
          draftIds: ['products'],
        },
        {
          kind: 'row',
          tableCreatedId: 'stable-table',
          entityCreatedId: 'row-a',
          headIds: ['first'],
          draftIds: ['second'],
        },
        {
          kind: 'row',
          tableCreatedId: 'stable-table',
          entityCreatedId: 'row-b',
          headIds: ['second'],
          draftIds: ['first'],
        },
      ],
    });

    const result = await resolveSelection(catalogue, {
      include: [{ kind: 'rows', tableId: 'products', rowIds: ['first'] }],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'AMBIGUOUS_IDENTITY' }],
    });
  });

  it('keeps exact schema-effect refs for a selected terminal rename lineage', async () => {
    const schemaEntry = {
      ...changeEntry('schemaField', 'terminal-lineage', {
        kind: 'schemaField',
        tableCreatedId: 'table-created',
        tableId: 'products',
        path: '/properties/label',
      }),
      effectRefs: [
        { historyIndex: 1, patchIndex: 0 },
        { historyIndex: 2, patchIndex: 1 },
      ],
    };

    const result = await resolveSelection(
      selectionCatalogue({ entries: [schemaEntry] }),
      { include: [{ kind: 'change', ref: ref('terminal-lineage') }] },
    );

    expect(result).toMatchObject({
      status: 'resolved',
      selected: [
        {
          ref: ref('terminal-lineage'),
          effectRefs: [
            { historyIndex: 1, patchIndex: 0 },
            { historyIndex: 2, patchIndex: 1 },
          ],
        },
      ],
    });
  });
});

function scopeOptions(changes: Record<string, string>): {
  branchId?: string;
  headRevisionId?: string;
  draftRevisionId?: string;
  draftRows?: Array<{ createdId: string; data: { title: string } }>;
} {
  if ('branchId' in changes) {
    return { branchId: changes['branchId'] };
  }
  if ('headRevisionId' in changes) {
    return { headRevisionId: changes['headRevisionId'] };
  }
  if ('draftRevisionId' in changes) {
    return { draftRevisionId: changes['draftRevisionId'] };
  }
  return {
    draftRows: [{ createdId: 'row-product', data: { title: 'Different' } }],
  };
}
