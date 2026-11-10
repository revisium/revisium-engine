import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { branchContentsOf } from 'src/__tests__/fixtures/branch-content';
import { addField } from 'src/__tests__/fixtures/ledger-steps';
import type { JsonValue } from 'src/engine-prisma-types';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { FieldRef } from 'src/features/partial-changes/selection/selection';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import type { RevisionSide } from '../../__tests__/support/snapshot-reading';

const PRODUCTS = 'products';
const GOODS = 'goods';
const OFFERS = 'offers';

const productSchema = obj({ title: str(), price: num() });
const offerSchema = obj({ title: str() });

const titleOfP1: FieldRef = { tableId: PRODUCTS, rowId: 'p1', path: '/title' };

const structureOf = (tableId: string) => ({
  kind: 'structure',
  tableId,
  selector: { structures: [{ tableId }] },
});

describe('views that follow the structure (AS-82)', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  describe('a table whose structure and views changed', () => {
    it('lists one structure unit that carries the views change, and no views unit', async () => {
      const draft = await givenProductsWithStructureViewsAndTitleEdited();

      const units = await draft.listEveryUnit();

      expect(units.map(({ kind }) => kind)).toEqual(['structure', 'field']);
      expect(units[0]).toMatchObject({
        structureChange: {
          table: 'changed',
          fields: [{ path: '/color', change: 'added' }],
          views: true,
        },
      });
    });

    it('commits the Draft views with the structure and keeps the other units of the table in the Draft', async () => {
      const draft = await givenProductsWithStructureViewsAndTitleEdited();

      await expect(
        draft.commitChanges({
          selection: { structures: [{ tableId: PRODUCTS }] },
        }),
      ).resolves.toMatchObject({ status: 'applied' });

      expect(await viewsOf(draft, 'head', PRODUCTS)).toEqual(editedViews());
      expect(kindsOf(await draft.listEveryUnit())).toEqual(['field']);
    });

    it('restores the Head views when the structure is reverted and keeps the other units of the table in the Draft', async () => {
      const draft = await givenProductsWithStructureViewsAndTitleEdited();

      await expect(
        draft.revertChanges({
          selection: { structures: [{ tableId: PRODUCTS }] },
        }),
      ).resolves.toMatchObject({ status: 'applied' });

      expect(await viewsOf(draft, 'draft', PRODUCTS)).toEqual(headViews());
      expect(kindsOf(await draft.listEveryUnit())).toEqual(['field']);
    });

    it.each<ChangeOperation>(['commit', 'revert'])(
      'requires the structure for views of the table in a %s, as structureBoundData',
      async (operation) => {
        const draft = await givenProductsWithStructureViewsAndTitleEdited();

        const preview = await draft.previewChanges({
          operation,
          selection: { views: [PRODUCTS] },
        });

        expect(preview).toMatchObject({
          status: 'required',
          unmatched: {},
          required: [
            {
              unit: structureOf(PRODUCTS),
              reason: {
                code: 'structureBoundData',
                because: 'the views of products change with its structure',
                site: { kind: 'selector', tableId: PRODUCTS },
              },
            },
          ],
        });
      },
    );

    it('excludes the structure with an excluded views selector and commits the rest', async () => {
      const draft = await givenProductsWithStructureViewsAndTitleEdited();

      await expect(
        draft.commitChanges({
          selection: { all: true, exclude: { views: [PRODUCTS] } },
        }),
      ).resolves.toMatchObject({ status: 'applied' });

      expect(await viewsOf(draft, 'head', PRODUCTS)).toEqual(headViews());
      expect(await titleOf(draft, 'head')).toBe('edited');
      expect(kindsOf(await draft.listEveryUnit())).toEqual(['structure']);
    });

    it('blocks a required structure that an excluded views selector excludes as requiredExcluded', async () => {
      const draft = await givenProductsWithStructureViewsAndTitleEdited();

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: {
          views: [PRODUCTS],
          exclude: { structures: [{ tableId: PRODUCTS }] },
        },
      });

      expect(preview).toMatchObject({
        status: 'blocked',
        blockers: [
          {
            code: 'requiredExcluded',
            tableId: PRODUCTS,
            reason: {
              code: 'structureBoundData',
              site: { kind: 'selector', tableId: PRODUCTS },
            },
          },
        ],
      });
    });
  });

  describe('a table whose structure changed while its views did not', () => {
    it('lists the structure unit without a views change', async () => {
      const draft = await givenProductsWithStructureEdited();

      const [structure] = await draft.listEveryUnit();

      expect(structure).toMatchObject({
        kind: 'structure',
        structureChange: { views: false },
      });
    });

    it('returns an included views selector of the table as unmatched', async () => {
      const draft = await givenProductsWithStructureEdited();

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: { views: [PRODUCTS] },
      });

      expect(preview).toMatchObject({
        status: 'empty',
        unmatched: { views: [PRODUCTS] },
      });
    });

    it('returns an excluded views selector of the table as unmatched', async () => {
      const draft = await givenProductsWithStructureEdited();

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: {
          structures: [{ tableId: PRODUCTS }],
          exclude: { views: [PRODUCTS] },
        },
      });

      expect(preview).toMatchObject({
        status: 'blocked',
        blockers: [{ code: 'unmatchedSelector' }],
        unmatched: { exclude: { views: [PRODUCTS] } },
      });
    });
  });

  describe('a renamed table with a views edit', () => {
    it('lists the rename with its views change and no views unit', async () => {
      const draft = await givenProductsRenamedWithViewsEdited();

      const units = await draft.listEveryUnit();

      expect(units).toEqual([
        expect.objectContaining({
          kind: 'structure',
          tableId: GOODS,
          previousTableId: PRODUCTS,
          structureChange: { table: 'changed', fields: [], views: true },
        }),
      ]);
    });

    it('commits the Draft views under the Draft id with the rename', async () => {
      const draft = await givenProductsRenamedWithViewsEdited();

      await draft.commitChanges({
        selection: { structures: [{ tableId: GOODS }] },
      });

      expect(await viewsOf(draft, 'head', GOODS)).toEqual(editedViews());
      expect(await draft.listEveryUnit()).toEqual([]);
    });

    it('restores the Head views under the Head id when the rename is reverted', async () => {
      const draft = await givenProductsRenamedWithViewsEdited();

      await draft.revertChanges({
        selection: { structures: [{ tableId: GOODS }] },
      });

      expect(await viewsOf(draft, 'draft', PRODUCTS)).toEqual(headViews());
      expect(await draft.listEveryUnit()).toEqual([]);
    });
  });

  describe('a table created in the Draft with views', () => {
    it('lists the created table with its views change', async () => {
      const draft = await givenCreatedOffersWithViews();

      const units = await draft.listEveryUnit();

      expect(units).toEqual([
        expect.objectContaining({
          kind: 'structure',
          tableId: OFFERS,
          structureChange: { table: 'created', fields: [], views: true },
        }),
      ]);
    });

    it('requires the created table for its views', async () => {
      const draft = await givenCreatedOffersWithViews();

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: { views: [OFFERS] },
      });

      expect(preview).toMatchObject({
        status: 'required',
        required: [
          {
            unit: structureOf(OFFERS),
            reason: {
              code: 'structureBoundData',
              site: { kind: 'selector', tableId: OFFERS },
            },
          },
        ],
      });
    });

    it('commits the views with the created table', async () => {
      const draft = await givenCreatedOffersWithViews();

      await draft.commitChanges({
        selection: { structures: [{ tableId: OFFERS }] },
      });

      expect(await viewsOf(draft, 'head', OFFERS)).toEqual(offerViews());
      expect(await draft.listEveryUnit()).toEqual([]);
    });

    it('removes the views with the reverted created table', async () => {
      const draft = await givenCreatedOffersWithViews();

      await draft.revertChanges({
        selection: { structures: [{ tableId: OFFERS }] },
      });

      expect(await draft.hasTable('draft', SystemTables.Views)).toBe(false);
      expect(await draft.listEveryUnit()).toEqual([]);
    });
  });

  describe('a removed or replaced table with views', () => {
    it.each<{
      change: string;
      edit: (draft: ChangesScenario) => Promise<void>;
      table: string;
      views: boolean;
    }>([
      {
        change: 'a removed table',
        edit: (draft) => draft.removeTable(PRODUCTS),
        table: 'removed',
        views: true,
      },
      {
        change: 'a table replaced by one with other views',
        edit: async (draft) => {
          await draft.removeTable(PRODUCTS);
          await draft.createTable(PRODUCTS, productSchema);
          await draft.updateViews(PRODUCTS, editedViews());
        },
        table: 'replaced',
        views: true,
      },
      {
        change: 'a table replaced by one with the same views',
        edit: async (draft) => {
          await draft.removeTable(PRODUCTS);
          await draft.createTable(PRODUCTS, productSchema);
          await draft.updateViews(PRODUCTS, headViews());
        },
        table: 'replaced',
        views: false,
      },
    ])(
      'says whether $change carries a views change',
      async ({ edit, table, views }) => {
        const draft = await givenCommittedProductsWithViews();
        await edit(draft);

        const [structure] = await draft.listEveryUnit();

        expect(structure).toMatchObject({
          kind: 'structure',
          structureChange: { table, views },
        });
      },
    );
  });

  describe('a Draft views document invalid for its own structure (AS-83)', () => {
    it('blocks a commit of the structure that holds it with invalidViews and writes nothing', async () => {
      const draft = await givenProductsWithStructureEdited();
      await draft.writeInvalidViews(
        PRODUCTS,
        tableViews('Broken', ['missing']),
      );
      const contents = await branchContentsOf(kit, draft);

      const result = await draft.commitChanges({
        selection: { structures: [{ tableId: PRODUCTS }] },
      });

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [
          {
            code: 'invalidViews',
            tableId: PRODUCTS,
            unit: structureOf(PRODUCTS),
          },
        ],
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });
  });

  describe('a table whose structure did not change', () => {
    it.each<ChangeOperation>(['commit', 'revert'])(
      'lists its views edit as a views unit that a %s applies alone',
      async (operation) => {
        const draft = await givenProductsWithViewsAndTitleEdited();
        const expected = operation === 'commit' ? editedViews() : headViews();
        const side: RevisionSide = operation === 'commit' ? 'head' : 'draft';

        expect(kindsOf(await draft.listEveryUnit())).toEqual([
          'views',
          'field',
        ]);
        await expect(
          applyOf(draft, operation, { views: [PRODUCTS] }),
        ).resolves.toMatchObject({ status: 'applied' });

        expect(await viewsOf(draft, side, PRODUCTS)).toEqual(expected);
        expect(kindsOf(await draft.listEveryUnit())).toEqual(['field']);
      },
    );
  });

  async function givenCommittedProductsWithViews(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', price: 1 } },
      },
    });
    await draft.updateViews(PRODUCTS, headViews());
    await draft.commit();

    return draft;
  }

  async function givenProductsWithStructureEdited(): Promise<ChangesScenario> {
    const draft = await givenCommittedProductsWithViews();
    await draft.updateTable(PRODUCTS, [addField('color', str())]);

    return draft;
  }

  async function givenProductsWithStructureViewsAndTitleEdited(): Promise<ChangesScenario> {
    const draft = await givenProductsWithStructureEdited();
    await draft.updateViews(PRODUCTS, editedViews());
    await draft.updateRow(PRODUCTS, 'p1', {
      title: 'edited',
      price: 1,
      color: '',
    });

    return draft;
  }

  async function givenProductsWithViewsAndTitleEdited(): Promise<ChangesScenario> {
    const draft = await givenCommittedProductsWithViews();
    await draft.updateViews(PRODUCTS, editedViews());
    await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', price: 1 });

    return draft;
  }

  async function givenProductsRenamedWithViewsEdited(): Promise<ChangesScenario> {
    const draft = await givenCommittedProductsWithViews();
    await draft.renameTable(PRODUCTS, GOODS);
    await draft.updateViews(GOODS, editedViews());

    return draft;
  }

  async function givenCreatedOffersWithViews(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {});
    await draft.createTable(OFFERS, offerSchema);
    await draft.updateViews(OFFERS, offerViews());

    return draft;
  }

  function applyOf(
    draft: ChangesScenario,
    operation: ChangeOperation,
    selection: { views: string[] },
  ): Promise<{ status: string }> {
    if (operation === 'commit') {
      return draft.commitChanges({ selection });
    }

    return draft.revertChanges({ selection });
  }

  async function titleOf(
    draft: ChangesScenario,
    side: RevisionSide,
  ): Promise<JsonValue> {
    const row = await draft.row(side, PRODUCTS, titleOfP1.rowId);

    return (row.data as { title: JsonValue }).title;
  }
});

async function viewsOf(
  draft: ChangesScenario,
  side: RevisionSide,
  tableId: string,
): Promise<JsonValue> {
  const row = await draft.row(side, SystemTables.Views, tableId);

  return row.data;
}

function kindsOf(units: readonly { kind: string }[]): string[] {
  return units.map(({ kind }) => kind);
}

function headViews(): TableViewsData {
  return tableViews('All', ['title', 'price']);
}

function editedViews(): TableViewsData {
  return tableViews('Edited', ['title']);
}

function offerViews(): TableViewsData {
  return tableViews('Offers', ['title']);
}

function tableViews(name: string, fields: readonly string[]): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'default',
    views: [
      {
        id: 'default',
        name,
        columns: fields.map((field) => ({ field: `data.${field}` })),
      },
    ],
  };
}
