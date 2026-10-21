import objectHash from 'object-hash';
import {
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import {
  expectTraced,
  headTable,
  liveTable,
} from '../source-history/support/source-results';
import {
  addTextField,
  productsSchema,
} from '../source-history/support/source-schemas';
import {
  createSourceHistoryTestKit,
  type SourceHistoryTestKit,
} from './support/source-history-scenario';

describe('Draft Changes source history: provenance', () => {
  let kit: SourceHistoryTestKit;

  beforeAll(async () => {
    kit = await createSourceHistoryTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('traces a branch without pending changes from its Head tables', async () => {
    const project = await kit.givenProject();
    await project.createTable('products', productsSchema);
    await project.commit();
    const createdId = await project.readTableCreatedId('products');

    const history = expectTraced(await project.trace());

    expect(history).toEqual({
      pendingEvents: [],
      tables: [
        {
          identity: createdId,
          head: { tableId: 'products', historyLength: 1 },
          draft: { tableId: 'products', createdId },
          pendingGroups: [],
        },
      ],
    });
  });

  it('identifies a pending table by its init event', async () => {
    const project = await kit.givenProject();
    await project.createTable('products', productsSchema);
    const createdId = await project.readTableCreatedId('products');

    const history = expectTraced(await project.trace());

    const [init] = history.pendingEvents;
    expect(liveTable(history, 'products')).toEqual({
      identity: init?.migration.id,
      draft: { tableId: 'products', createdId },
      pendingGroups: [
        {
          historyIndex: 0,
          origin: { kind: 'init', eventIndex: 0 },
          foreignKeys: [],
        },
      ],
    });
  });

  it('attributes a pending update group to its update event', async () => {
    const project = await kit.givenProject();
    await project.createTable('products', productsSchema);
    await project.commit();
    await project.updateTable('products', addTextField('color'));

    const history = expectTraced(await project.trace());

    expect(liveTable(history, 'products').pendingGroups).toEqual([
      {
        historyIndex: 1,
        origin: { kind: 'update', eventIndex: 0 },
        foreignKeys: [],
      },
    ]);
  });

  it('keeps a removed Head table with its Head side only', async () => {
    const project = await kit.givenProject();
    await project.createTable('products', productsSchema);
    await project.commit();
    const createdId = await project.readTableCreatedId('products');
    await project.removeTable('products');

    const history = expectTraced(await project.trace());

    expect(headTable(history, 'products')).toStrictEqual({
      identity: createdId,
      head: { tableId: 'products', historyLength: 1 },
      pendingGroups: [],
    });
  });

  it('traces imported events in application order when their ids sort differently', async () => {
    const project = await kit.givenProject();
    const initId = '2026-03-01T10:00:00.000Z';
    const updateId = '2026-03-01T09:00:00-05:00';
    await project.importMigrations([
      {
        changeType: 'init',
        id: initId,
        tableId: 'products',
        hash: objectHash(productsSchema),
        schema: productsSchema,
      },
      {
        changeType: 'update',
        id: updateId,
        tableId: 'products',
        hash: objectHash(
          getObjectSchema({
            title: getStringSchema(),
            color: getStringSchema(),
          }),
        ),
        patches: addTextField('color'),
      },
    ]);

    const history = expectTraced(await project.trace());

    expect(
      history.pendingEvents.map(({ migration, tableIdentity }) => ({
        id: migration.id,
        tableIdentity,
      })),
    ).toEqual([
      { id: initId, tableIdentity: initId },
      { id: updateId, tableIdentity: initId },
    ]);
  });
});
