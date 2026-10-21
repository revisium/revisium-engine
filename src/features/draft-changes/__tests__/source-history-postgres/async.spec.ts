import {
  expectTraced,
  headTable,
  liveTable,
} from '../source-history/support/source-results';
import {
  addTextField,
  productsSchema,
  referencing,
} from '../source-history/support/source-schemas';
import {
  createSourceHistoryTestKit,
  type SourceHistoryTestKit,
} from './support/source-history-scenario';

describe('Draft Changes source history: background schema updates', () => {
  let kit: SourceHistoryTestKit;

  beforeAll(async () => {
    kit = await createSourceHistoryTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('traces a background update of a committed table from Head data', async () => {
    const project = await kit.givenProject();
    await project.createTable('products', productsSchema);
    await project.fillRowsToAsyncThreshold('products', { title: 'item' });
    await project.commit();
    await project.updateTableInBackground('products', addTextField('extra'));

    const history = expectTraced(await project.trace());

    expect(history.pendingEvents).toEqual([]);
    expect(liveTable(history, 'products')).toMatchObject({
      pendingGroups: [],
    });
    expect(liveTable(history, 'products').taint).toBeUndefined();
  });

  it('taints a Draft-owned schema changed by an unrecorded background update', async () => {
    const project = await kit.givenProject();
    await project.createTable('orders', productsSchema);
    await project.commit();
    await project.createTable('products', productsSchema);
    await project.fillRowsToAsyncThreshold('products', { title: 'item' });
    await project.updateTableInBackground('products', addTextField('extra'));

    const history = expectTraced(await project.trace());

    expect(liveTable(history, 'products')).toMatchObject({
      pendingGroups: [expect.objectContaining({ historyIndex: 0 })],
      taint: { code: 'SOURCE_SCHEMA_UNRECORDED_CHANGE', fromHistoryIndex: 1 },
    });
    expect(liveTable(history, 'orders').taint).toBeUndefined();
  });

  it('taints the sync update recorded after an unrecorded background update', async () => {
    const project = await kit.givenProject();
    await project.createTable('products', productsSchema);
    await project.fillRowsToAsyncThreshold('products', { title: 'item' });
    await project.updateTableInBackground('products', addTextField('extra'));
    await project.dropRowsBelowAsyncThreshold('products');
    await project.updateTable('products', addTextField('note'));

    const history = expectTraced(await project.trace());

    expect(liveTable(history, 'products')).toMatchObject({
      pendingGroups: [expect.objectContaining({ historyIndex: 0 })],
      taint: { code: 'SOURCE_EVENT_UNREPLAYABLE', fromHistoryIndex: 1 },
    });
  });

  it('taints a referrer whose reference was dropped in the background before its target was removed', async () => {
    const project = await kit.givenProject();
    await project.createTable('categories', productsSchema);
    await project.createRows('categories', [
      { rowId: 'category', data: { title: 'category' } },
    ]);
    await project.commit();
    await project.createTable('products', referencing('categories'));
    await project.fillRowsToAsyncThreshold('products', {
      categories: 'category',
    });
    await project.updateTableInBackground('products', [
      { op: 'remove', path: '/properties/categories' },
    ]);
    await project.removeTable('categories');

    const history = expectTraced(await project.trace());

    expect(liveTable(history, 'products')).toMatchObject({
      pendingGroups: [expect.objectContaining({ historyIndex: 0 })],
      taint: { code: 'SOURCE_REFERENCE_INCONSISTENT', fromHistoryIndex: 1 },
    });
    expect(headTable(history, 'categories').taint).toBeUndefined();
  });
});
