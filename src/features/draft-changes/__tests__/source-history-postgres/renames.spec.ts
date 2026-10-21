import {
  expectTraced,
  liveTable,
} from '../source-history/support/source-results';
import {
  addReferenceField,
  productsSchema,
  referenceFields,
  referencing,
  replaceReference,
} from '../source-history/support/source-schemas';
import {
  createSourceHistoryTestKit,
  type SourceHistoryTestKit,
} from './support/source-history-scenario';

describe('Draft Changes source history: renames', () => {
  let kit: SourceHistoryTestKit;

  beforeAll(async () => {
    kit = await createSourceHistoryTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('attributes the retargeted referrer history to the rename event', async () => {
    const project = await kit.givenProject();
    await project.createTable('categories', productsSchema);
    await project.createTable('products', referencing('categories'));
    await project.commit();
    const categoriesId = await project.readTableCreatedId('categories');
    await project.renameTable('categories', 'catalog');

    const history = expectTraced(await project.trace());

    expect(liveTable(history, 'products').pendingGroups).toEqual([
      {
        historyIndex: 1,
        origin: { kind: 'renameReference', eventIndex: 0 },
        foreignKeys: [
          {
            path: '/properties/categories',
            targetTableId: 'catalog',
            targetIdentity: categoriesId,
          },
        ],
      },
    ]);
  });

  it('attributes a self reference retarget to the renamed table', async () => {
    const project = await kit.givenProject();
    await project.createTable(
      'categories',
      referenceFields({ parent: 'categories' }),
    );
    await project.commit();
    const categoriesId = await project.readTableCreatedId('categories');
    await project.renameTable('categories', 'catalog');

    const history = expectTraced(await project.trace());

    expect(liveTable(history, 'catalog').pendingGroups).toEqual([
      {
        historyIndex: 1,
        origin: { kind: 'renameReference', eventIndex: 0 },
        foreignKeys: [
          {
            path: '/properties/parent',
            targetTableId: 'catalog',
            targetIdentity: categoriesId,
          },
        ],
      },
    ]);
  });

  it('retargets every reference field of one referrer in one group', async () => {
    const project = await kit.givenProject();
    await project.createTable('categories', productsSchema);
    await project.createTable(
      'products',
      referenceFields({ main: 'categories', backup: 'categories' }),
    );
    await project.commit();
    await project.renameTable('categories', 'catalog');

    const history = expectTraced(await project.trace());

    const groups = liveTable(history, 'products').pendingGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0]?.foreignKeys).toEqual([
      expect.objectContaining({
        path: '/properties/backup',
        targetTableId: 'catalog',
      }),
      expect.objectContaining({
        path: '/properties/main',
        targetTableId: 'catalog',
      }),
    ]);
  });

  it('keeps a user update apart from an identical rename retarget', async () => {
    const project = await kit.givenProject();
    await project.createTable('categories', productsSchema);
    await project.createTable('products', referencing('categories'));
    await project.commit();
    await project.renameTable('categories', 'catalog');
    await project.updateTable(
      'products',
      replaceReference('categories', 'catalog'),
    );

    const history = expectTraced(await project.trace());

    expect(
      liveTable(history, 'products').pendingGroups.map(
        ({ historyIndex, origin }) => ({ historyIndex, origin }),
      ),
    ).toEqual([
      { historyIndex: 1, origin: { kind: 'renameReference', eventIndex: 0 } },
      { historyIndex: 2, origin: { kind: 'update', eventIndex: 1 } },
    ]);
  });

  it('retargets a referrer whose pending field sorts before its committed field in storage', async () => {
    const project = await kit.givenProject();
    await project.createTable('categories', productsSchema);
    await project.createTable(
      'products',
      referenceFields({ zeta: 'categories' }),
    );
    await project.commit();
    await project.updateTable('products', addReferenceField('a', 'categories'));
    await project.renameTable('categories', 'catalog');

    const history = expectTraced(await project.trace());

    const products = liveTable(history, 'products');
    expect(products.taint).toBeUndefined();
    expect(
      products.pendingGroups.filter(
        ({ origin }) => origin.kind === 'renameReference',
      ),
    ).toHaveLength(1);
  });

  it('retargets a referrer whose moved field sorts before its other field in storage', async () => {
    const project = await kit.givenProject();
    await project.createTable('categories', productsSchema);
    await project.createTable(
      'products',
      referenceFields({ beta: 'categories', zeta: 'categories' }),
    );
    await project.commit();
    await project.updateTable('products', [
      { op: 'move', from: '/properties/zeta', path: '/properties/a' },
    ]);
    await project.renameTable('categories', 'catalog');

    const history = expectTraced(await project.trace());

    const products = liveTable(history, 'products');
    expect(products.taint).toBeUndefined();
    expect(
      products.pendingGroups.filter(
        ({ origin }) => origin.kind === 'renameReference',
      ),
    ).toHaveLength(1);
  });

  it('keeps identities with their tables through a name swap', async () => {
    const project = await kit.givenProject();
    await project.createTable('products', productsSchema);
    await project.createTable('orders', productsSchema);
    await project.commit();
    const productsId = await project.readTableCreatedId('products');
    const ordersId = await project.readTableCreatedId('orders');
    await project.renameTable('products', 'swap');
    await project.renameTable('orders', 'products');
    await project.renameTable('swap', 'orders');

    const history = expectTraced(await project.trace());

    expect(liveTable(history, 'orders').identity).toBe(productsId);
    expect(liveTable(history, 'products').identity).toBe(ordersId);
  });
});
