import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { addField } from 'src/__tests__/fixtures/ledger-steps';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { ListedUnit } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const PRODUCTS = 'products';
const BRANDS = 'brands';

const OPERATIONS: ChangeOperation[] = ['commit', 'revert'];

const productSchema = obj({ title: str(), price: num() });
const brandSchema = obj({ title: str() });

const colorOfP1: Selection = {
  fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/color' }],
};
const colorOfP1WithoutStructure: Selection = {
  ...colorOfP1,
  exclude: { structures: [{ tableId: PRODUCTS }] },
};
const creationOfP2: Selection = { rows: [{ tableId: PRODUCTS, rowId: 'p2' }] };
const structureOfProducts: Selection = { structures: [{ tableId: PRODUCTS }] };

describe('structure units in preview and apply results', () => {
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

  describe('previewChanges', () => {
    it.each(OPERATIONS)(
      'describes the structure unit a %s requires as the listing does',
      async (operation) => {
        const draft = await givenProductsGettingColor();

        const preview = await draft.previewChanges({
          operation,
          selection: colorOfP1,
        });

        expect(preview.required.map(({ unit }) => unit)).toEqual([
          await listedStructureOf(draft),
        ]);
      },
    );

    it('describes the structure a deferred row is committed without as the listing does', async () => {
      const draft = await givenProductsGettingColor();

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: creationOfP2,
      });

      expect(preview.deferred.map(({ structure }) => structure)).toEqual([
        await listedStructureOf(draft),
      ]);
    });

    it('describes a sampled structure unit as the listing does', async () => {
      const draft = await givenProductsGettingColor();

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: structureOfProducts,
      });

      expect(preview.sample).toEqual([await listedStructureOf(draft)]);
    });

    it('describes the excluded structure unit of a blocker as the listing does', async () => {
      const draft = await givenProductsGettingColor();

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: colorOfP1WithoutStructure,
      });

      expect(preview.blockers.map(({ unit }) => unit)).toEqual([
        await listedStructureOf(draft),
      ]);
    });
  });

  describe('the cause of a reason (AS-85)', () => {
    it('describes the structure unit a required unit is caused by as the listing does', async () => {
      const draft = await givenProductsReferencingCreatedBrands();
      const products = await listedStructureOf(draft);

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: structureOfProducts,
      });

      expect(preview.required.map(({ reason }) => reason.cause)).toEqual([
        { unit: products, role: 'referrer' },
      ]);
    });

    it('describes the same cause in the reason of a requiredExcluded blocker', async () => {
      const draft = await givenProductsReferencingCreatedBrands();
      const products = await listedStructureOf(draft);

      const result = await draft.commitChanges({
        selection: {
          ...structureOfProducts,
          exclude: { structures: [{ tableId: BRANDS }] },
        },
      });

      const excluded =
        'blockers' in result
          ? result.blockers.find(({ code }) => code === 'requiredExcluded')
          : undefined;

      expect(result.status).toBe('blocked');
      expect(excluded?.reason).toMatchObject({
        code: 'referencedTableMissing',
        site: { kind: 'schema', tableId: PRODUCTS },
        references: { kind: 'table', tableId: BRANDS },
        cause: { unit: products, role: 'referrer' },
      });
    });
  });

  describe('commitChanges and revertChanges', () => {
    it('describes the structure unit a commit requires as the listing does', async () => {
      const draft = await givenProductsGettingColor();
      const structure = await listedStructureOf(draft);

      const result = await draft.commitChanges({ selection: colorOfP1 });

      expect(result).toEqual({
        status: 'required',
        required: [
          {
            unit: structure,
            reason: expect.objectContaining({ code: 'structureBoundData' }),
          },
        ],
      });
    });

    it('describes the excluded structure unit that blocks a revert as the listing does', async () => {
      const draft = await givenProductsGettingColor();
      const structure = await listedStructureOf(draft);

      const result = await draft.revertChanges({
        selection: colorOfP1WithoutStructure,
      });

      expect(result).toEqual({
        status: 'blocked',
        blockers: [
          expect.objectContaining({
            code: 'requiredExcluded',
            unit: structure,
          }),
        ],
        required: [],
      });
    });
  });

  async function listedStructureOf(
    draft: ChangesScenario,
  ): Promise<ListedUnit> {
    const { units } = await draft.listChanges({ tableId: PRODUCTS });
    const structure = units.find(({ kind }) => kind === 'structure');

    if (!structure?.structureChange) {
      throw new Error(
        `The listing does not describe the structure of ${PRODUCTS}`,
      );
    }

    return structure;
  }

  async function givenProductsReferencingCreatedBrands(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema },
    });
    await draft.createTable(BRANDS, brandSchema);
    await draft.updateTable(PRODUCTS, [
      addField('brand', str({ foreignKey: BRANDS })),
    ]);

    return draft;
  }

  async function givenProductsGettingColor(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', price: 1 } },
      },
    });
    await draft.updateTable(PRODUCTS, [addField('color', str())]);
    await draft.updateRow(PRODUCTS, 'p1', {
      title: 'one',
      price: 1,
      color: 'red',
    });
    await draft.createRows(PRODUCTS, {
      p2: { title: 'two', price: 2, color: 'blue' },
    });

    return draft;
  }
});
