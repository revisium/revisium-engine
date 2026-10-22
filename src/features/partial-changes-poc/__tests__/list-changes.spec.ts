import { obj, str } from '@revisium/schema-toolkit/mocks';
import { SnapshotReader } from 'src/features/partial-changes-poc/snapshot/snapshot-reader.service';
import { transactionReadOnlyDuring } from 'src/features/partial-changes-poc/__tests__/support/transaction-mode';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  orderSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';
import {
  expectSelectsExactly,
  publicPartOf,
} from 'src/features/partial-changes-poc/__tests__/support/listed-units';

const tagSchema = obj({ label: str() });

const viewsNamed = (name: string) => ({
  version: 1,
  defaultViewId: 'default',
  views: [{ id: 'default', name, columns: [{ field: 'data.title' }] }],
});

describe('listChanges: paged list of selectable units', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

  afterAll(async () => {
    await kit.close();
  });

  async function givenEveryDataUnitKind() {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: productSchema,
        rows: {
          p1: product('one', 10),
          p2: product('two', 20),
          p3: product('three', 30),
          p4: product('four', 40),
        },
      },
    });
    await scenario.patchRow('products', 'p1', { price: 11 });
    await scenario.createRow('products', 'p5', product('five', 50));
    await scenario.removeRow('products', 'p2');
    await scenario.removeRow('products', 'p3');
    await scenario.createRow('products', 'p3', product('new three', 33));
    await scenario.renameRow('products', 'p4', 'p4b');
    await scenario.patchRow('products', 'p4b', { price: 41 });
    return scenario;
  }

  async function givenStructureUnits() {
    const scenario = await ChangesScenario.committed(
      kit,
      {
        products: { schema: productSchema, rows: { p1: product('one', 10) } },
        orders: {
          schema: orderSchema,
          rows: { o1: { product: 'p1', note: '' } },
        },
        tags: { schema: tagSchema, rows: { t1: { label: 'a' } } },
      },
      (draft) => draft.updateViews('products', viewsNamed('All')),
    );
    await scenario.addField('products', 'color', str());
    await scenario.patchRow('products', 'p1', { price: 11 });
    await scenario.updateViews('products', viewsNamed('Edited'));
    await scenario.renameTable('tags', 'labels');
    await scenario.createTable('notes', obj({ text: str() }));
    await scenario.removeTable('orders');
    return scenario;
  }

  it('lists every data unit kind with its public ids', async () => {
    const scenario = await givenEveryDataUnitKind();

    const units = await scenario.listAllChanges();

    expect(units.map(publicPartOf)).toEqual([
      { kind: 'field', tableId: 'products', rowId: 'p1', path: '/price' },
      { kind: 'rowDelete', tableId: 'products', rowId: 'p2' },
      { kind: 'rowReplace', tableId: 'products', rowId: 'p3' },
      { kind: 'field', tableId: 'products', rowId: 'p4b', path: '/price' },
      {
        kind: 'rowRename',
        tableId: 'products',
        rowId: 'p4b',
        previousRowId: 'p4',
      },
      { kind: 'rowCreate', tableId: 'products', rowId: 'p5' },
    ]);
  });

  it('gives each data unit a selector that previews exactly that unit', async () => {
    const scenario = await givenEveryDataUnitKind();

    for (const unit of await scenario.listAllChanges()) {
      await expectSelectsExactly(scenario, unit);
    }
  });

  it('lists structure, views and table lifecycle units and links data units to their structure', async () => {
    const scenario = await givenStructureUnits();

    const units = await scenario.listAllChanges();

    expect(
      units.map((unit) => ({ ...publicPartOf(unit), link: unit.structure })),
    ).toEqual([
      {
        kind: 'structure',
        tableId: 'labels',
        previousTableId: 'tags',
        link: undefined,
      },
      { kind: 'structure', tableId: 'notes', link: undefined },
      { kind: 'structure', tableId: 'orders', link: undefined },
      { kind: 'structure', tableId: 'products', link: undefined },
      {
        kind: 'views',
        tableId: 'products',
        link: { kind: 'structure', tableId: 'products' },
      },
      {
        kind: 'field',
        tableId: 'products',
        rowId: 'p1',
        path: '/price',
        link: { kind: 'structure', tableId: 'products' },
      },
    ]);
  });

  it('gives each structure and views unit a selector that previews exactly that unit', async () => {
    const scenario = await givenStructureUnits();

    for (const unit of await scenario.listAllChanges()) {
      await expectSelectsExactly(scenario, unit);
    }
  });

  it('lists a row rename with a renames selector (decision 4)', async () => {
    const scenario = await givenEveryDataUnitKind();

    const units = await scenario.listAllChanges();

    expect(units.find((unit) => unit.kind === 'rowRename')?.selector).toEqual({
      renames: [{ tableId: 'products', rowId: 'p4b' }],
    });
  });

  it('applies a listed rename selector without field edits made after the listing (N5)', async () => {
    const scenario = await givenEveryDataUnitKind();
    const rename = (await scenario.listAllChanges()).find(
      (unit) => unit.kind === 'rowRename',
    );
    await scenario.patchRow('products', 'p4b', { title: 'edited later' });

    const result = await scenario.commit(rename?.selector ?? {});

    expect(result.status).toBe('applied');
    expect((await scenario.headRow('products', 'p4b')).data).toEqual(
      product('four', 40),
    );
    expect((await scenario.draftRow('products', 'p4b')).data).toEqual({
      ...product('four', 41),
      title: 'edited later',
    });
  });

  it('addresses a deleted row whose id a rename took over through the Head side', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: productSchema,
        rows: { a: product('first', 1), b: product('second', 2) },
      },
    });
    await scenario.removeRow('products', 'b');
    await scenario.renameRow('products', 'a', 'b');

    const units = await scenario.listAllChanges();

    expect(units.find((unit) => unit.kind === 'rowDelete')).toMatchObject({
      rowId: 'b',
      side: 'head',
      selector: { rows: [{ tableId: 'products', rowId: 'b', side: 'head' }] },
    });
    for (const unit of units) {
      await expectSelectsExactly(scenario, unit);
    }
  });

  it('addresses a removed table whose id a rename took over through the Head side', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      first: { schema: tagSchema, rows: { a1: { label: 'a' } } },
      second: { schema: tagSchema, rows: { b1: { label: 'b' } } },
    });
    await scenario.removeTable('second');
    await scenario.renameTable('first', 'second');

    const units = await scenario.listAllChanges();

    expect(units.map(publicPartOf)).toEqual([
      { kind: 'structure', tableId: 'second' },
      { kind: 'structure', tableId: 'second', previousTableId: 'first' },
    ]);
    expect(units[0]).toMatchObject({
      side: 'head',
      selector: { tables: [{ tableId: 'second', side: 'head' }] },
    });
    for (const unit of units) {
      await expectSelectsExactly(scenario, unit);
    }
  });

  it('lists both renames of a row id swap, each previewing the other as required', async () => {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: productSchema,
        rows: { a: product('first', 1), b: product('second', 2) },
      },
    });
    await scenario.renameRow('products', 'a', 'swap');
    await scenario.renameRow('products', 'b', 'a');
    await scenario.renameRow('products', 'swap', 'b');

    const units = await scenario.listAllChanges();

    expect(units.map(publicPartOf)).toEqual([
      {
        kind: 'rowRename',
        tableId: 'products',
        rowId: 'a',
        previousRowId: 'b',
      },
      {
        kind: 'rowRename',
        tableId: 'products',
        rowId: 'b',
        previousRowId: 'a',
      },
    ]);
    for (const unit of units) {
      const preview = await expectSelectsExactly(scenario, unit);
      expect(preview.status).toBe('required');
    }
  });

  it('reads the units inside a read-only transaction', async () => {
    const scenario = await givenEveryDataUnitKind();

    const readOnly = await transactionReadOnlyDuring(
      kit,
      kit.module.get(SnapshotReader),
      'read',
      () => scenario.listChanges(),
    );

    expect(readOnly).toBe('on');
  });

  it('pages through the units with a cursor', async () => {
    const scenario = await givenEveryDataUnitKind();
    const all = await scenario.listChanges({ limit: 100 });

    const first = await scenario.listChanges({ limit: 4 });
    const second = await scenario.listChanges({
      cursor: first.nextCursor,
      limit: 4,
    });

    expect(first.units).toEqual(all.units.slice(0, 4));
    expect(second.units).toEqual(all.units.slice(4));
    expect(second.nextCursor).toBeUndefined();
  });
});
