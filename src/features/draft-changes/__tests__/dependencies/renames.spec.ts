import type { JsonSchema } from '@revisium/schema-toolkit/types';
import {
  requireResolvedDependencies,
  resolvedRowData,
} from './support/dependency-results';
import {
  givenSelfRowRenameWithForeignKey,
  givenSelfTableRenameWithForeignKey,
  givenMovedSelfTableRenameWithForeignKey,
  resolveDependencies,
  schemaForTable,
} from './support/dependency-scenario';
import {
  project,
  requiredProjected,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-results';
import { pluginRefs } from '@revisium/schema-toolkit/lib';
import { validateSchemaHistory } from 'src/features/draft-changes/schema/schema-history';
import {
  addField,
  givenSchemaPatchGroups,
  givenSchemaProjection,
  numberField,
  rowInput,
  stringField,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';
import { schemaWith } from 'src/features/draft-changes/__tests__/candidates/support/candidate-scenario';
import { givenSwappedTablesWithIndependentDraftForeignKey } from './support/dependency-table-swap-scenario';
import { givenTwoArrayReferencesWithRenamedTarget } from './support/dependency-array-scenario';
import {
  buildCatalogue,
  givenCatalogueScenario,
} from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import { selectedCandidateData } from 'src/features/draft-changes/__tests__/candidates/support/candidate-scenario';
import { resolveSelection } from 'src/features/draft-changes/__tests__/selection/support/selection-fixture';

describe('draft changes candidate reference renames', () => {
  it('rewrites a selected self table rename at its declared schema FK', async () => {
    const { data, causeRef, fromTableId, toTableId } =
      await givenSelfTableRenameWithForeignKey();

    const result = await resolveDependencies(data);

    const resolved = requireResolvedDependencies(result);
    expect(resolved.automatic).toEqual([
      {
        kind: 'schemaForeignKey',
        role: 'head',
        tableCreatedId: 'stable-products',
        targetTableCreatedId: 'stable-products',
        path: '/properties/link',
        before: fromTableId,
        after: toTableId,
        causeRefs: [causeRef],
      },
    ]);
    expect(schemaForTable(resolved.head, toTableId)).toMatchObject({
      properties: {
        link: { foreignKey: toTableId, description: 'Head link' },
      },
    });
    expect(schemaForTable(resolved.draft, toTableId)).toMatchObject({
      properties: { link: { description: 'Draft link' } },
    });
    expect(resolved.required).toEqual([]);
    expect(
      resolvedRowData(result, 'head', 'stable-products', 'product'),
    ).toEqual({
      link: 'product',
      note: 'Head',
    });
    expect(
      resolvedRowData(result, 'draft', 'stable-products', 'product'),
    ).toEqual({
      link: 'product',
      note: 'Draft',
    });
  });

  it('rewrites a case-only table rename using native exact-name matching', async () => {
    const { data, causeRef, fromTableId, toTableId } =
      await givenSelfTableRenameWithForeignKey({
        fromTableId: 'Products',
        toTableId: 'products',
      });

    const result = await resolveDependencies(data);

    expect(requireResolvedDependencies(result).automatic).toContainEqual({
      kind: 'schemaForeignKey',
      role: 'head',
      tableCreatedId: 'stable-products',
      targetTableCreatedId: 'stable-products',
      path: '/properties/link',
      before: fromTableId,
      after: toTableId,
      causeRefs: [causeRef],
    });
  });

  it('keeps a reference bound to its actual candidate target when another target rename is pending', async () => {
    const linkSchema: JsonSchema = {
      type: 'string',
      default: 'product',
      foreignKey: 'products',
    };
    const schema = schemaWith({ link: linkSchema, note: stringField() });
    const scenario = await givenCatalogueScenario({
      headSchema: schema,
      draftSchema: schema,
      headRows: [rowInput('product', { link: 'product', note: 'Head' })],
      draftRows: [
        rowInput('product', { link: 'renamed-product', note: 'Draft' }),
      ],
      headRowIds: { product: 'product' },
      draftRowIds: { product: 'renamed-product' },
    });
    const catalogue = await buildCatalogue(scenario);
    const note = catalogue.entries.find(
      (entry) => entry.kind === 'rowField' && entry.path === '/note',
    );
    if (!note) {
      throw new Error('Expected the independent note edit.');
    }
    const selection = await resolveSelection(catalogue, {
      include: [{ kind: 'change', ref: note.ref }],
    });
    if (selection.status !== 'resolved') {
      throw new Error('Expected the note selection to resolve.');
    }
    const data = selectedCandidateData(
      scenario.snapshot,
      catalogue,
      'commit',
      selection,
    );

    const result = requireResolvedDependencies(await resolveDependencies(data));

    expect(
      resolvedRowData(result, 'head', 'stable-products', 'product'),
    ).toEqual({
      link: 'product',
      note: 'Draft',
    });
    expect(
      resolvedRowData(result, 'draft', 'stable-products', 'product'),
    ).toEqual({
      link: 'renamed-product',
      note: 'Draft',
    });
    expect(result.required).toEqual([]);
  });

  it('rewrites only the array occurrence bound to the renamed row', async () => {
    const data = await givenTwoArrayReferencesWithRenamedTarget();

    const result = requireResolvedDependencies(await resolveDependencies(data));

    expect(
      resolvedRowData(result, 'head', 'stable-products', 'source'),
    ).toMatchObject({ links: [{ target: 'b' }, { target: 'x' }] });
    expect(
      resolvedRowData(result, 'draft', 'stable-products', 'source'),
    ).toMatchObject({ links: [{ target: 'b' }, { target: 'x' }] });
  });

  it('retargets the Head FK across a table-name swap and preserves Draft binding', async () => {
    const { data, targetRenameRef } =
      await givenSwappedTablesWithIndependentDraftForeignKey();

    const result = await resolveDependencies(data);

    const resolved = requireResolvedDependencies(result);
    expect(resolved.automatic).toEqual([
      {
        kind: 'schemaForeignKey',
        role: 'head',
        tableCreatedId: 'stable-products',
        targetTableCreatedId: 'stable-secondary-products',
        path: '/properties/link',
        before: 'secondary-products',
        after: 'products',
        causeRefs: [targetRenameRef],
      },
    ]);
    expect(schemaForTable(resolved.head, 'secondary-products')).toMatchObject({
      properties: { link: { foreignKey: 'products' } },
    });
    expect(schemaForTable(resolved.draft, 'secondary-products')).toMatchObject({
      properties: {
        link: {
          foreignKey: 'secondary-products',
          description: 'Draft independent target',
        },
      },
    });
    expect(
      resolvedRowData(result, 'draft', 'stable-products', 'source-row'),
    ).toMatchObject({ link: 'source-row' });
  });

  it.each([
    ['commit', 'head', 'product', 'renamed-product'],
    ['discard', 'draft', 'renamed-product', 'product'],
  ] as const)(
    'rewrites the renamed self row reference in the %s candidate role',
    async (operation, role, before, after) => {
      const { data, causeRef } =
        await givenSelfRowRenameWithForeignKey(operation);

      const result = await resolveDependencies(data);

      const resolved = requireResolvedDependencies(result);
      expect(resolved.automatic).toEqual([
        {
          kind: 'rowForeignKey',
          role,
          tableCreatedId: 'stable-products',
          rowCreatedId: 'product',
          targetTableCreatedId: 'stable-products',
          targetRowCreatedId: 'product',
          path: '/link',
          before,
          after,
          causeRefs: [causeRef],
        },
      ]);
      expect(
        resolvedRowData(result, role, 'stable-products', 'product'),
      ).toMatchObject({ link: after });
    },
  );

  it('applies a lower identity-bound retarget while preserving role histories', async () => {
    const { data, toTableId } = await givenSelfTableRenameWithForeignKey();

    const result = requiredProjected(
      await project({
        snapshot: data.snapshot,
        tableCreatedId: 'stable-products',
        operation: 'commit',
        effects: [],
        foreignKeyRetargets: [
          {
            targetTableCreatedId: 'stable-products',
            fromTableId: 'products',
            toTableId,
          },
        ],
      }),
    );

    expect(result.foreignKeyChanges).toEqual([
      {
        role: 'head',
        targetTableCreatedId: 'stable-products',
        path: '/properties/link',
        before: 'products',
        after: toTableId,
      },
    ]);
    expect(result.head.schema).toMatchObject({
      properties: {
        link: { foreignKey: toTableId, description: 'Head link' },
      },
    });
    expect(result.draft.schema).toMatchObject({
      properties: {
        link: { foreignKey: toTableId, description: 'Draft link' },
      },
    });
    expect(
      validateSchemaHistory(result.head.schema, result.head.history, {
        ...pluginRefs,
      }),
    ).toBeUndefined();
    expect(
      validateSchemaHistory(result.draft.schema, result.draft.history, {
        ...pluginRefs,
      }),
    ).toBeUndefined();
  });

  it('selects only the original ADD coordinate and retains a grouped Draft description', async () => {
    const headSchema = schemaWith({ title: stringField() });
    const draftField = { ...numberField(), description: 'Draft description' };
    const history = givenSchemaPatchGroups(headSchema, [
      [addField('/properties/extra', numberField())],
      [
        {
          op: 'replace',
          path: '/properties/extra',
          value: draftField,
        },
      ],
    ]);
    const projection = givenSchemaProjection({
      headSchema,
      draftSchema: history.terminalSchema,
      pending: history.steps,
      headRows: [rowInput('product', { title: 'Head' })],
      draftRows: [rowInput('product', { title: 'Draft', extra: 7 })],
    });

    const result = requiredProjected(
      await project({
        ...projection,
        operation: 'commit',
        effects: [{ historyIndex: 1, patchIndex: 0 }],
      }),
    );

    expect(result.head.schema).toMatchObject({
      properties: { extra: numberField() },
    });
    expect(result.head.schema).not.toHaveProperty(
      'properties.extra.description',
    );
    expect(result.draft.schema).toMatchObject({
      properties: { extra: { description: 'Draft description' } },
    });
    expect(result.head.history).toEqual(
      result.draft.history.slice(0, result.head.history.length),
    );
  });

  it('retargets the same FK after its field was moved in an earlier history group', async () => {
    const data = await givenMovedSelfTableRenameWithForeignKey();
    const originalSnapshot = structuredClone(data.snapshot);

    const projection = {
      snapshot: data.snapshot,
      tableCreatedId: 'stable-products',
      operation: 'commit' as const,
      effects: [],
      foreignKeyRetargets: [
        {
          targetTableCreatedId: 'stable-products',
          fromTableId: 'products',
          toTableId: 'renamed-products',
        },
      ],
    };
    const result = requiredProjected(await project(projection));
    const repeated = requiredProjected(await project(projection));

    expect(result.foreignKeyChanges).toEqual([
      {
        role: 'head',
        targetTableCreatedId: 'stable-products',
        path: '/properties/oldLink',
        before: 'products',
        after: 'renamed-products',
      },
    ]);
    expect(result.head.schema).toMatchObject({
      properties: {
        oldLink: {
          foreignKey: 'renamed-products',
          description: 'Head link',
        },
      },
    });
    expect(result.head.schema).not.toHaveProperty('properties.link');
    expect(result.draft.schema).toMatchObject({
      properties: {
        link: { foreignKey: 'renamed-products', description: 'Draft link' },
      },
    });
    expect(result.head.history).toEqual(
      result.draft.history.slice(0, result.head.history.length),
    );
    expect(repeated).toEqual(result);
    expect(data.snapshot).toEqual(originalSnapshot);
    expect(
      validateSchemaHistory(result.head.schema, result.head.history, {
        ...pluginRefs,
      }),
    ).toBeUndefined();
    expect(
      validateSchemaHistory(result.draft.schema, result.draft.history, {
        ...pluginRefs,
      }),
    ).toBeUndefined();
  });

  it('rejects a retarget whose stable target identity is absent', async () => {
    const { data } = await givenSelfTableRenameWithForeignKey();

    const result = await project({
      snapshot: data.snapshot,
      tableCreatedId: 'stable-products',
      operation: 'commit',
      effects: [],
      foreignKeyRetargets: [
        {
          targetTableCreatedId: 'missing-target-identity',
          fromTableId: 'products',
          toTableId: 'renamed-products',
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'INVALID_EFFECT_REFERENCE' })],
    });
  });

  it('rejects a caller retarget carrying an unknown rename cause', async () => {
    const { data } = await givenSelfTableRenameWithForeignKey();
    data.additionalSchemaEffects = [
      {
        kind: 'foreignKeyRetarget',
        tableCreatedId: 'stable-products',
        targetTableCreatedId: 'stable-products',
        fromTableId: 'products',
        toTableId: 'renamed-products',
        causeRef: { value: 'unknown-rename-cause' },
      },
    ];

    const result = await resolveDependencies(data);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'INVALID_SELECTION' })],
    });
  });
});
