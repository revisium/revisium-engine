import { obj, str } from '@revisium/schema-toolkit/mocks';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  expectLedgerReplaysTo,
  expectReplicaMirrorsHead,
  Replica,
} from 'src/features/partial-changes-poc/__tests__/support/replica';
import { publicPartOf } from 'src/features/partial-changes-poc/__tests__/support/listed-units';
import {
  orderSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';

const tagSchema = obj({ label: str() });

describe('table lifecycle as structure units', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

  afterAll(async () => {
    await kit.close();
  });

  async function givenSyncedReplica(scenario: ChangesScenario) {
    const replica = await Replica.create(kit);
    await expectReplicaMirrorsHead(replica, scenario);
    return replica;
  }

  describe('created table', () => {
    async function givenCreatedTable() {
      const scenario = await ChangesScenario.committed(kit, {
        products: { schema: productSchema, rows: { p1: product('one', 1) } },
      });
      await scenario.createTable('tags', tagSchema);
      await scenario.createRows('tags', {
        t1: { label: 'first' },
        t2: { label: 'second' },
      });
      await scenario.patchRow('products', 'p1', { price: 2 });
      return scenario;
    }

    it('commits the table whole with its rows', async () => {
      const scenario = await givenCreatedTable();
      const replica = await givenSyncedReplica(scenario);

      const result = await scenario.commit({ tables: ['tags'] });

      expect(result.status).toBe('applied');
      expect(await scenario.headRowIds('tags')).toEqual(['t1', 't2']);
      expect((await scenario.headRow('products', 'p1')).data.price).toBe(1);
      await expectReplicaMirrorsHead(replica, scenario);
    });

    it('requires the table structure for a row of the created table', async () => {
      const scenario = await givenCreatedTable();

      const preview = await scenario.preview('commit', {
        rows: [{ tableId: 'tags', rowId: 't1' }],
      });

      expect(preview.required).toEqual([
        {
          unit: { kind: 'structure', tableId: 'tags' },
          reason: expect.objectContaining({ code: 'structureBoundData' }),
        },
      ]);
    });
  });

  it('commits a removed table and its ledger entry', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      products: { schema: productSchema, rows: { p1: product('one', 1) } },
      tags: { schema: tagSchema, rows: { t1: { label: 'first' } } },
    });
    const replica = await givenSyncedReplica(scenario);
    await scenario.removeTable('tags');
    await scenario.patchRow('products', 'p1', { price: 2 });

    const result = await scenario.commit({ tables: ['tags'] });

    expect(result.status).toBe('applied');
    expect(await scenario.tableIds('head')).toEqual(['products']);
    expect((await scenario.headRow('products', 'p1')).data.price).toBe(1);
    await expectReplicaMirrorsHead(replica, scenario);
  });

  describe('renamed table referenced by another table', () => {
    async function givenProductsRenamedToGoods() {
      const scenario = await ChangesScenario.committed(kit, {
        products: { schema: productSchema, rows: { p1: product('one', 1) } },
        orders: {
          schema: orderSchema,
          rows: { o1: { product: 'p1', note: '' } },
        },
      });
      await scenario.renameTable('products', 'goods');
      return scenario;
    }

    it('requires the referrer whose schema the rename rewrote', async () => {
      const scenario = await givenProductsRenamedToGoods();

      const result = await scenario.commit({ tables: ['goods'] });

      expect(result.status).toBe('required');
      expect(result.required).toEqual([
        {
          unit: { kind: 'structure', tableId: 'orders' },
          reason: expect.objectContaining({
            code: 'referrerStillReferences',
            tableId: 'orders',
          }),
        },
      ]);
    });

    it('requires the renamed table for the rewritten referrer', async () => {
      const scenario = await givenProductsRenamedToGoods();

      const preview = await scenario.preview('commit', { tables: ['orders'] });

      expect(preview.required).toEqual([
        {
          unit: {
            kind: 'structure',
            tableId: 'goods',
            previousTableId: 'products',
          },
          reason: expect.objectContaining({ code: 'referencedTableMissing' }),
        },
      ]);
    });

    it('commits the rename with its referrer and keeps a replica in sync', async () => {
      const scenario = await givenProductsRenamedToGoods();
      const replica = await givenSyncedReplica(scenario);

      const result = await scenario.commitWithRequired({ tables: ['goods'] });

      expect(result.status).toBe('applied');
      expect(await scenario.tableIds('head')).toEqual(['goods', 'orders']);
      expect(await scenario.headRowIds('goods')).toEqual(['p1']);
      await expectReplicaMirrorsHead(replica, scenario);
    });
  });

  describe('foreign keys to new tables and rows', () => {
    it('requires a new table referenced by the schema of the selected table', async () => {
      const scenario = await ChangesScenario.committed(kit, {});
      await scenario.createTable('categories', tagSchema);
      await scenario.createRow('categories', 'c1', { label: 'first' });
      await scenario.createTable(
        'labels',
        obj({ category: str({ foreignKey: 'categories' }) }),
      );
      await scenario.createRow('labels', 'l1', { category: 'c1' });

      const preview = await scenario.preview('commit', { tables: ['labels'] });

      expect(preview.required).toEqual([
        {
          unit: { kind: 'structure', tableId: 'categories' },
          reason: expect.objectContaining({
            code: 'referencedTableMissing',
            tableId: 'categories',
          }),
        },
      ]);
    });

    it('requires a new row referenced by a row of the created table', async () => {
      const scenario = await ChangesScenario.committed(kit, {
        products: { schema: productSchema, rows: { p1: product('one', 1) } },
      });
      await scenario.createRow('products', 'p2', product('two', 2));
      await scenario.createTable('reviews', orderSchema);
      await scenario.createRow('reviews', 'r1', { product: 'p2', note: '' });

      const result = await scenario.commit({ tables: ['reviews'] });

      expect(result.status).toBe('required');
      expect(result.required).toEqual([
        {
          unit: { kind: 'rowCreate', tableId: 'products', rowId: 'p2' },
          reason: expect.objectContaining({ code: 'referencedRowMissing' }),
        },
      ]);
    });
  });

  describe('removed and re-created table id', () => {
    async function givenTagsReplaced() {
      const scenario = await ChangesScenario.committed(kit, {
        tags: { schema: tagSchema, rows: { t1: { label: 'old' } } },
      });
      await scenario.removeTable('tags');
      await scenario.createTable('tags', obj({ name: str(), code: str() }));
      await scenario.createRow('tags', 'x1', { name: 'new', code: 'n' });
      return scenario;
    }

    it('selects the removal and the re-creation as one unit', async () => {
      const scenario = await givenTagsReplaced();

      const preview = await scenario.preview('commit', { tables: ['tags'] });

      expect(preview).toMatchObject({
        status: 'ready',
        counts: { selected: 1, required: 0, remaining: 0 },
      });
    });

    it('commits the re-created table and keeps a replica in sync', async () => {
      const scenario = await givenTagsReplaced();
      const replica = await givenSyncedReplica(scenario);

      await scenario.commit({ tables: ['tags'] });

      expect(await scenario.headRowIds('tags')).toEqual(['x1']);
      await expectReplicaMirrorsHead(replica, scenario);
    });
  });

  it('requires the removal of the table whose id a rename takes over', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      first: { schema: tagSchema, rows: { a1: { label: 'a' } } },
      second: { schema: tagSchema, rows: { b1: { label: 'b' } } },
    });
    await scenario.removeTable('second');
    await scenario.renameTable('first', 'second');

    const preview = await scenario.preview('commit', { tables: ['second'] });

    expect(preview.required).toEqual([
      {
        unit: { kind: 'structure', tableId: 'second' },
        reason: expect.objectContaining({ code: 'idOccupied' }),
      },
    ]);
  });

  it('addresses the removal of a table id taken over by a rename with side head', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      first: { schema: tagSchema, rows: { a1: { label: 'a' } } },
      second: { schema: tagSchema, rows: { b1: { label: 'b' } } },
    });
    await scenario.removeTable('second');
    await scenario.renameTable('first', 'second');

    const result = await scenario.commit({
      tables: [{ tableId: 'second', side: 'head' }],
    });

    expect(result.status).toBe('applied');
    expect(await scenario.tableIds('head')).toEqual(['first']);
    expect(await scenario.tableIds('draft')).toEqual(['second']);
  });

  it('requires the other half of a table id swap', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      first: { schema: tagSchema, rows: { a1: { label: 'a' } } },
      second: { schema: tagSchema, rows: { b1: { label: 'b' } } },
    });
    await scenario.renameTable('first', 'swap');
    await scenario.renameTable('second', 'first');
    await scenario.renameTable('swap', 'second');

    const preview = await scenario.preview('commit', { tables: ['second'] });

    expect(preview.required).toEqual([
      {
        unit: {
          kind: 'structure',
          tableId: 'first',
          previousTableId: 'second',
        },
        reason: expect.objectContaining({ code: 'idOccupied' }),
      },
    ]);
  });

  describe('tables created and removed inside the Draft', () => {
    async function givenTransientTable() {
      const scenario = await ChangesScenario.committed(kit, {
        products: { schema: productSchema, rows: { p1: product('one', 1) } },
      });
      await scenario.createTable('tmp', tagSchema);
      await scenario.createRow('tmp', 'x1', { label: 'temporary' });
      await scenario.removeTable('tmp');
      await scenario.patchRow('products', 'p1', { price: 2 });
      return scenario;
    }

    async function givenRecreatedTransientId() {
      const scenario = await ChangesScenario.committed(kit, {
        products: { schema: productSchema, rows: { p1: product('one', 1) } },
      });
      await scenario.createTable('tmp', tagSchema);
      await scenario.removeTable('tmp');
      await scenario.createTable('tmp', obj({ name: str() }));
      await scenario.createRow('tmp', 'y1', { name: 'kept' });
      return scenario;
    }

    it('lists the created and removed table as one structure unit', async () => {
      const scenario = await givenTransientTable();

      const units = await scenario.listAllChanges();

      expect(units.map(publicPartOf)).toEqual([
        { kind: 'field', tableId: 'products', rowId: 'p1', path: '/price' },
        { kind: 'structure', tableId: 'tmp' },
      ]);
    });

    it('commits its migrations alone and keeps a replica in sync', async () => {
      const scenario = await givenTransientTable();
      const replica = await givenSyncedReplica(scenario);

      const result = await scenario.commit({ tables: ['tmp'] });

      expect(result.status).toBe('applied');
      expect(await scenario.tableIds('head')).toEqual(['products']);
      expect((await scenario.headRow('products', 'p1')).data.price).toBe(1);
      await expectReplicaMirrorsHead(replica, scenario);
    });

    it('keeps its migrations replayable in the Draft when other data is committed', async () => {
      const scenario = await givenTransientTable();
      const replica = await givenSyncedReplica(scenario);

      await scenario.commit({
        fields: [{ tableId: 'products', rowId: 'p1', path: '/price' }],
      });

      await expectReplicaMirrorsHead(replica, scenario);
      await expectLedgerReplaysTo(kit, scenario, 'draft');
    });

    it('reverts its migrations out of the Draft ledger', async () => {
      const scenario = await givenTransientTable();
      const headLedger = await scenario.ledger('head');

      const result = await scenario.revert({ tables: ['tmp'] });

      expect(result.status).toBe('applied');
      expect(await scenario.ledger('draft')).toEqual(headLedger);
    });

    it('lists a re-created table id with its earlier incarnation as one unit', async () => {
      const scenario = await givenRecreatedTransientId();

      const units = await scenario.listAllChanges();

      expect(units.map(publicPartOf)).toEqual([
        { kind: 'structure', tableId: 'tmp' },
      ]);
    });

    it('commits a re-created table id with its earlier incarnation and keeps a replica in sync', async () => {
      const scenario = await givenRecreatedTransientId();
      const replica = await givenSyncedReplica(scenario);

      const result = await scenario.commit({ tables: ['tmp'] });

      expect(result.status).toBe('applied');
      expect(await scenario.headRowIds('tmp')).toEqual(['y1']);
      await expectReplicaMirrorsHead(replica, scenario);
      await expectLedgerReplaysTo(kit, scenario, 'draft');
    });

    it('commits two incarnations of the same transient id as one unit', async () => {
      const scenario = await givenTransientTable();
      await scenario.createTable('tmp', obj({ name: str() }));
      await scenario.removeTable('tmp');
      const replica = await givenSyncedReplica(scenario);

      const preview = await scenario.preview('commit', { tables: ['tmp'] });
      const result = await scenario.commit({ tables: ['tmp'] });

      expect(preview.counts).toEqual({
        selected: 1,
        required: 0,
        remaining: 0,
      });
      expect(preview.unreadTables).toBe(1);
      expect(result.status).toBe('applied');
      await expectReplicaMirrorsHead(replica, scenario);
    });
  });
});
