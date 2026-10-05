import { createCandidateViewScenario } from '../views/support/candidate-view-scenario';
import { tableViews } from '../views/support/view-test-data';
import type { TableViewsData } from 'src/features/views/types';
import { expectUnchangedDraftSnapshot } from '../support/snapshot-assertions';

const invalidCandidates = [
  {
    name: 'malformed stored-view shape',
    mutate: (_views: TableViewsData) => null,
    code: 'INVALID_VIEW_DATA',
  },
  {
    name: 'duplicate view IDs',
    mutate: (views: TableViewsData) => ({
      ...views,
      views: [...views.views, { ...views.views[0] }],
    }),
    code: 'INVALID_VIEW_IDENTITY',
  },
  {
    name: 'default ID outside the views list',
    mutate: (views: TableViewsData) => ({ ...views, defaultViewId: 'missing' }),
    code: 'INVALID_VIEW_IDENTITY',
  },
  {
    name: 'empty views without an invented replacement default',
    mutate: (views: TableViewsData) => ({ ...views, views: [] }),
    code: 'INVALID_VIEW_IDENTITY',
  },
  {
    name: 'field outside the final schema',
    mutate: (views: TableViewsData) => ({
      ...views,
      views: views.views.map((view) => ({
        ...view,
        columns: [{ field: 'data.missing', width: 100 }],
      })),
    }),
    code: 'INVALID_VIEW_DATA',
  },
] as const;

describe('Draft Changes native restore candidate validation', () => {
  it.each(invalidCandidates)(
    'blocks $name in a detached restore candidate',
    async ({ mutate, code }) => {
      const scenario = await createCandidateViewScenario();
      try {
        const legalHeadViews = tableViews();
        await scenario.seedHeadViews(legalHeadViews);
        const source = await scenario.readSnapshot();
        const result = await scenario.resolveRestoreHeadWithViews(
          mutate(legalHeadViews),
        );

        expect(result).toMatchObject({
          status: 'blocked',
          blockers: [expect.objectContaining({ code })],
        });
        expectUnchangedDraftSnapshot(source, await scenario.readSnapshot());
      } finally {
        await scenario.close();
      }
    },
  );
});
