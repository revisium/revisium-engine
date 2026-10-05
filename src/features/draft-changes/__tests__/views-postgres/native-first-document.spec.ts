import {
  createCandidateViewScenario,
  requireProjected,
} from '../views/support/candidate-view-scenario';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { storedTableViews, tableViews } from '../views/support/view-test-data';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';

describe('Draft Changes native first stored view document', () => {
  it('publishes all exact first-document refs when the source has no views container', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const source = await scenario.readSnapshot();
      expect(systemTable(source.head, SystemTables.Views)).toBeUndefined();
      expect(schemaRow(source.head, SystemTables.Views)).toBeUndefined();
      expect(schemaRow(source.draft, SystemTables.Views)).toBeUndefined();
      const firstViews = tableViews('First views');
      await scenario.updateDraftViews(firstViews);
      const afterSave = await scenario.readSnapshot();
      expect(schemaRow(afterSave.draft, SystemTables.Views)).toBeUndefined();
      const tableCreatedId = requireTable(
        afterSave.draft,
        'products',
      ).createdId;
      expect(systemTable(afterSave.draft, SystemTables.Views)).toBeDefined();
      const catalogue = await scenario.catalogue();
      const documentEntries = catalogue.entries.filter(
        ({ target }) =>
          (target.kind === 'view' || target.kind === 'viewConfiguration') &&
          target.tableCreatedId === tableCreatedId,
      );
      expect(documentEntries.length).toBeGreaterThan(0);

      const prepared = await scenario.prepareSelectedInput('commit', {
        include: [{ kind: 'table', tableId: 'products', rows: 'none' }],
      });
      expect(
        prepared.query.selection.selected.map(({ ref }) => ref.value).sort(),
      ).toEqual(documentEntries.map(({ ref }) => ref.value).sort());
      const result = requireProjected(
        await scenario.resolveSuppliedInput(prepared.query),
      );

      expect(storedTableViews(result.head, 'products')).toEqual(firstViews);
      expect(storedTableViews(result.draft, 'products')).toEqual(firstViews);
      const publishedViewsTable = systemTable(result.head, SystemTables.Views);
      expect(publishedViewsTable).toBeDefined();
      const sourceViewsTable = requireTable(
        afterSave.draft,
        SystemTables.Views,
      );
      expect(publishedViewsTable).toMatchObject({
        createdId: sourceViewsTable.createdId,
        readonly: sourceViewsTable.readonly,
        system: sourceViewsTable.system,
      });
      expect(schemaRow(result.head, SystemTables.Views)).toBeUndefined();
      expect(schemaRow(result.draft, SystemTables.Views)).toBeUndefined();
      const sourceViewRow = requireViewRow(afterSave.draft, 'products');
      expect(requireViewRow(result.head, 'products')).toMatchObject({
        createdId: sourceViewRow.createdId,
        schemaHash: sourceViewRow.schemaHash,
        meta: sourceViewRow.meta,
        data: sourceViewRow.data,
      });
      expect(await scenario.readSnapshot()).toEqual(afterSave);
    } finally {
      await scenario.close();
    }
  });

  it('discards all exact first-document refs without creating a Head views container', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      const source = await scenario.readSnapshot();
      expect(systemTable(source.head, SystemTables.Views)).toBeUndefined();
      expect(schemaRow(source.head, SystemTables.Views)).toBeUndefined();
      expect(schemaRow(source.draft, SystemTables.Views)).toBeUndefined();
      await scenario.updateDraftViews(tableViews('First views'));
      const afterSave = await scenario.readSnapshot();
      expect(schemaRow(afterSave.draft, SystemTables.Views)).toBeUndefined();
      const tableCreatedId = requireTable(
        afterSave.draft,
        'products',
      ).createdId;
      const catalogue = await scenario.catalogue();
      const documentEntries = catalogue.entries.filter(
        ({ target }) =>
          (target.kind === 'view' || target.kind === 'viewConfiguration') &&
          target.tableCreatedId === tableCreatedId,
      );
      expect(documentEntries.length).toBeGreaterThan(0);

      const prepared = await scenario.prepareSelectedInput('discard', {
        include: [{ kind: 'table', tableId: 'products', rows: 'none' }],
      });
      expect(
        prepared.query.selection.selected.map(({ ref }) => ref.value).sort(),
      ).toEqual(documentEntries.map(({ ref }) => ref.value).sort());
      const result = requireProjected(
        await scenario.resolveSuppliedInput(prepared.query),
      );

      expect(storedTableViews(result.head, 'products')).toBeUndefined();
      expect(storedTableViews(result.draft, 'products')).toBeUndefined();
      expect(systemTable(result.head, SystemTables.Views)).toBeUndefined();
      expect(schemaRow(result.head, SystemTables.Views)).toBeUndefined();
      expect(schemaRow(result.draft, SystemTables.Views)).toBeUndefined();
      expect(await scenario.readSnapshot()).toEqual(afterSave);
    } finally {
      await scenario.close();
    }
  });
});

function systemTable(state: DraftRevisionState, tableId: string) {
  return state.tables.find(({ id }) => id === tableId);
}

function requireTable(state: DraftRevisionState, tableId: string) {
  const table = state.tables.find(({ id }) => id === tableId);
  if (!table) {
    throw new Error(`Expected native table '${tableId}'.`);
  }
  return table;
}

function schemaRow(state: DraftRevisionState, tableId: string) {
  return systemTable(state, SystemTables.Schema)?.rows.find(
    ({ id }) => id === tableId,
  );
}

function viewRow(state: DraftRevisionState, tableId: string) {
  return systemTable(state, SystemTables.Views)?.rows.find(
    ({ id }) => id === tableId,
  );
}

function requireViewRow(state: DraftRevisionState, tableId: string) {
  const row = viewRow(state, tableId);
  if (!row) {
    throw new Error(`Expected native views row '${tableId}'.`);
  }
  return row;
}
