import {
  expectTraced,
  headTable,
  liveTable,
  pendingTable,
} from '../source-history/support/source-results';
import {
  productsSchema,
  referencing,
} from '../source-history/support/source-schemas';
import {
  createSourceHistoryTestKit,
  type SourceHistoryTestKit,
} from './support/source-history-scenario';

describe('Draft Changes source history: table lifetimes', () => {
  let kit: SourceHistoryTestKit;

  beforeAll(async () => {
    kit = await createSourceHistoryTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('gives a removed table and its re-created namesake separate identities', async () => {
    const project = await kit.givenProject();
    await project.createTable('products', productsSchema);
    await project.commit();
    const headCreatedId = await project.readTableCreatedId('products');
    await project.removeTable('products');
    await project.createTable('products', productsSchema);

    const history = expectTraced(await project.trace());

    expect(headTable(history, 'products').identity).toBe(headCreatedId);
    expect(liveTable(history, 'products').identity).toBe(
      history.pendingEvents[1]?.migration.id,
    );
    expect(history.tables).toHaveLength(2);
  });

  it('resolves a pending reference to a transient table identity', async () => {
    const project = await kit.givenProject();
    await project.createTable('categories', productsSchema);
    await project.createTable('products', referencing('categories'));
    await project.updateTable('products', [
      { op: 'remove', path: '/properties/categories' },
    ]);
    await project.removeTable('categories');

    const history = expectTraced(await project.trace());

    const categories = pendingTable(history, 0);
    expect(categories).toMatchObject({
      identity: history.pendingEvents[0]?.migration.id,
    });
    expect(categories.head).toBeUndefined();
    expect(categories.draft).toBeUndefined();
    expect(liveTable(history, 'products').pendingGroups[0]).toEqual({
      historyIndex: 0,
      origin: { kind: 'init', eventIndex: 1 },
      foreignKeys: [
        {
          path: '/properties/categories',
          targetTableId: 'categories',
          targetIdentity: categories.identity,
        },
      ],
    });
  });
});
