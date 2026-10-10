import { NotFoundException } from '@nestjs/common';
import { getNumberSchema } from '@revisium/schema-toolkit/mocks';
import type { JsonPatch } from '@revisium/schema-toolkit/types';
import { givenReadingScenario } from './support/reading-scenario';
import { useReadingTestKit } from './support/reading-test-kit';
import { tableViews } from '../views/support/view-test-data';

describe('Draft Changes reader: table details', () => {
  const kit = useReadingTestKit();

  it('returns complete schema leaves separately from row leaves', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { price: 10 },
      draft: { price: 20 },
    });
    await scenario.patchDraftSchema([
      { op: 'move', from: '/properties/price', path: '/properties/cost' },
    ]);

    const result = await kit().changes.draftTableChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
    });

    expect(result.schemaChanges.length).toBeGreaterThan(0);
    expect(result.rowCount).toBe(1);
  });

  it('returns complete view leaves beside schema leaves', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { price: 10 },
    });
    await scenario.patchDraftSchema([
      { op: 'move', from: '/properties/price', path: '/properties/cost' },
    ]);
    const draftViews = tableViews('Draft view');
    await scenario.updateDraftViews({
      ...draftViews,
      views: draftViews.views.map((view) => ({
        ...view,
        columns: [{ field: 'data.cost', width: 100 }],
      })),
    });

    const result = await kit().changes.draftTableChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
    });

    expect(result.schemaChanges.length).toBeGreaterThan(0);
    expect(result.viewsChanges?.length).toBeGreaterThan(0);
  });

  it('does not truncate schema details without a continuation field', async () => {
    const scenario = await givenReadingScenario(kit(), { head: {} });
    const fields: JsonPatch[] = Array.from({ length: 101 }, (_, index) => ({
      op: 'add',
      path: `/properties/field${index}`,
      value: getNumberSchema(),
    }));
    await scenario.patchDraftSchema(fields);

    const result = await kit().changes.draftTableChanges({
      ...scenario.branch,
      tableId: scenario.tableId,
    });

    expect(result.schemaChanges).toHaveLength(101);
  });

  it('resolves the previous public table ID for details', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { value: 1 },
      tableId: 'products-old',
    });
    await scenario.renameDraftTable('products-new');

    const details = await kit().changes.draftTableChanges({
      ...scenario.branch,
      tableId: 'products-old',
    });

    expect(details.tableId).toBe('products-new');
  });

  it('rejects details for an unknown table', async () => {
    const scenario = await givenReadingScenario(kit(), { head: { value: 1 } });

    await expect(
      kit().changes.draftTableChanges({
        ...scenario.branch,
        tableId: 'missing-table',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
