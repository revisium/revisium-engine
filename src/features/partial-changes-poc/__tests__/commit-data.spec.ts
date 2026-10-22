import objectHash from 'object-hash';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  pricedProductSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';

describe('partial commit of data changes', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

  afterAll(async () => {
    await kit.close();
  });

  async function givenTwoEditedProducts() {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: productSchema,
        rows: { p1: product('one', 10), p2: product('two', 20) },
      },
    });
    await scenario.patchRow('products', 'p1', { price: 11 });
    await scenario.patchRow('products', 'p2', { price: 21 });
    return scenario;
  }

  it('commits one selected row of two edited rows into the new Head', async () => {
    const scenario = await givenTwoEditedProducts();
    const previousHeadRevisionId = await scenario.headRevisionId();
    const draftRevisionId = await scenario.draftRevisionId();

    const result = await scenario.commit({
      rows: [{ tableId: 'products', rowId: 'p1' }],
    });

    expect(result).toMatchObject({
      status: 'applied',
      previousHeadRevisionId,
      headRevisionId: draftRevisionId,
      applied: { selected: 1, required: 0 },
      remaining: { units: 1 },
    });
    expect((await scenario.headRow('products', 'p1')).data.price).toBe(11);
    expect((await scenario.headRow('products', 'p2')).data.price).toBe(20);
  });

  it('keeps every edit in the new Draft and marks it as changed', async () => {
    const scenario = await givenTwoEditedProducts();

    const result = await scenario.commit({
      rows: [{ tableId: 'products', rowId: 'p1' }],
    });

    expect(result.draftRevisionId).toBe(await scenario.draftRevisionId());
    expect((await scenario.draftRow('products', 'p1')).data.price).toBe(11);
    expect((await scenario.draftRow('products', 'p2')).data.price).toBe(21);
    expect(await scenario.draftHasChanges()).toBe(true);
    const remaining = await scenario.preview('commit', { all: true });
    expect(remaining.counts.selected).toBe(1);
    expect(remaining.sample).toEqual([
      { kind: 'field', tableId: 'products', rowId: 'p2', path: '/price' },
    ]);
  });

  it('links the new Head to the previous schema history and migration ledger', async () => {
    const scenario = await givenTwoEditedProducts();
    const previousHeadRevisionId = await scenario.headRevisionId();

    await scenario.commit({ rows: [{ tableId: 'products', rowId: 'p1' }] });

    const headRevisionId = await scenario.headRevisionId();
    for (const systemTable of [SystemTables.Schema, SystemTables.Migration]) {
      const previous = await systemTableVersion(
        previousHeadRevisionId,
        systemTable,
      );
      expect(await systemTableVersion(headRevisionId, systemTable)).toBe(
        previous,
      );
    }
  });

  it('marks the Draft unchanged after the last remaining unit is committed', async () => {
    const scenario = await givenTwoEditedProducts();

    await scenario.commit({ rows: [{ tableId: 'products', rowId: 'p1' }] });
    await scenario.commit({ rows: [{ tableId: 'products', rowId: 'p2' }] });

    expect(await scenario.draftHasChanges()).toBe(false);
    expect((await scenario.headRow('products', 'p2')).data.price).toBe(21);
  });

  describe('field units', () => {
    async function givenTwoEditedFields() {
      const scenario = await ChangesScenario.committed(kit, {
        products: {
          schema: pricedProductSchema,
          rows: { p1: { price: 10, qty: 2, total: 0 } },
        },
      });
      await scenario.patchRow('products', 'p1', { price: 11, qty: 3 });
      return scenario;
    }

    it('commits one of two edited fields as a merged row version with recomputed formula and hash', async () => {
      const scenario = await givenTwoEditedFields();
      const previousHead = await scenario.headRow('products', 'p1');
      const draft = await scenario.draftRow('products', 'p1');

      const result = await scenario.commit({
        fields: [{ tableId: 'products', rowId: 'p1', path: '/price' }],
      });

      expect(result.status).toBe('applied');
      const head = await scenario.headRow('products', 'p1');
      expect(head.data).toEqual({ price: 11, qty: 2, total: 22 });
      expect(head.hash).toBe(objectHash(head.data));
      expect(head.schemaHash).toBe(objectHash(pricedProductSchema));
      expect(head.createdId).toBe(previousHead.createdId);
      expect(head.readonly).toBe(true);
      expect([previousHead.versionId, draft.versionId]).not.toContain(
        head.versionId,
      );
    });

    it('leaves the unselected field edit in the Draft as the only remaining unit', async () => {
      const scenario = await givenTwoEditedFields();

      await scenario.commit({
        fields: [{ tableId: 'products', rowId: 'p1', path: '/price' }],
      });

      expect((await scenario.draftRow('products', 'p1')).data).toEqual({
        price: 11,
        qty: 3,
        total: 33,
      });
      const remaining = await scenario.preview('commit', { all: true });
      expect(remaining.sample).toEqual([
        { kind: 'field', tableId: 'products', rowId: 'p1', path: '/qty' },
      ]);
    });

    it('refuses a formula output as a selected unit', async () => {
      const scenario = await givenTwoEditedFields();
      const draftRevisionId = await scenario.draftRevisionId();

      const result = await scenario.commit({
        fields: [{ tableId: 'products', rowId: 'p1', path: '/total' }],
      });

      expect(result.status).toBe('blocked');
      expect(result.blockers).toEqual([
        expect.objectContaining({
          code: 'notSelectable',
          tableId: 'products',
          rowId: 'p1',
          path: '/total',
        }),
      ]);
      expect(await scenario.draftRevisionId()).toBe(draftRevisionId);
    });
  });

  describe('row lifecycle units', () => {
    it('commits a selected created row and keeps an unselected created row in the Draft only', async () => {
      const scenario = await ChangesScenario.committed(kit, {
        products: { schema: productSchema, rows: { p1: product('one', 10) } },
      });
      await scenario.createRow('products', 'p2', product('two', 20));
      await scenario.createRow('products', 'p3', product('three', 30));

      await scenario.commit({ rows: [{ tableId: 'products', rowId: 'p2' }] });

      expect(await scenario.headRowIds('products')).toEqual(['p1', 'p2']);
      expect(await scenario.draftRowIds('products')).toEqual([
        'p1',
        'p2',
        'p3',
      ]);
      const committed = await scenario.headRow('products', 'p2');
      expect(committed).toEqual(await scenario.draftRow('products', 'p2'));
      expect(committed.readonly).toBe(true);
    });

    it('commits a selected deletion and keeps an unselected deletion in the Draft only', async () => {
      const scenario = await ChangesScenario.committed(kit, {
        products: {
          schema: productSchema,
          rows: { p1: product('one', 10), p2: product('two', 20) },
        },
      });
      await scenario.removeRow('products', 'p1');
      await scenario.removeRow('products', 'p2');

      await scenario.commit({ rows: [{ tableId: 'products', rowId: 'p1' }] });

      expect(await scenario.headRowIds('products')).toEqual(['p2']);
      expect(await scenario.draftRowIds('products')).toEqual([]);
    });
  });

  async function systemTableVersion(revisionId: string, tableId: string) {
    const table = await kit.prisma.table.findFirstOrThrow({
      where: { id: tableId, revisions: { some: { id: revisionId } } },
    });
    return table.versionId;
  }
});
