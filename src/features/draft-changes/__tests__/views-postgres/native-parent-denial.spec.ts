import {
  createCandidateViewScenario,
  requireCatalogueEntry,
} from '../views/support/candidate-view-scenario';
import {
  getNumberSchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import { tableViews } from '../views/support/view-test-data';

describe('Draft Changes native view parent denial', () => {
  it('blocks a selected new-table view when its exact table creation is denied', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      await scenario.createDraftTable(
        'new-products',
        getObjectSchema({ price: getNumberSchema(), title: getStringSchema() }),
      );
      await scenario.updateDraftViewsForTable(
        'new-products',
        tableViews('New products'),
      );
      const snapshot = await scenario.readSnapshot();
      const createdId = snapshot.draft.tables.find(
        ({ id, system }) => id === 'new-products' && !system,
      )?.createdId;
      const tableCreatedId = requireCreatedId(createdId);
      const view = requireCatalogueEntry(
        await scenario.viewEntry('main', 'lifecycle', tableCreatedId),
      );
      const parent = requireCatalogueEntry(
        await scenario.tableEntry(tableCreatedId),
      );

      const result = await scenario.resolveSelectionWithBlockers('commit', {
        include: [{ kind: 'change', ref: view.ref }],
        exclude: [{ kind: 'change', ref: parent.ref }],
      });

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [expect.objectContaining({ code: 'EXCLUDED_PREREQUISITE' })],
      });
    } finally {
      await scenario.close();
    }
  });
});

function requireCreatedId(value: string | undefined): string {
  if (!value) {
    throw new Error('Expected the native Draft table identity.');
  }
  return value;
}
