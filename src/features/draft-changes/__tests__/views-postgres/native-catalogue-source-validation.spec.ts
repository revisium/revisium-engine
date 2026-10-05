import { createCandidateViewScenario } from '../views/support/candidate-view-scenario';
import { tableViews } from '../views/support/view-test-data';

describe('Draft Changes native catalogue source validation', () => {
  it('blocks a malformed stored Draft document instead of advertising deletions', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      await scenario.seedHeadViews(tableViews());
      const source = await scenario.readSnapshot();

      const result = await scenario.catalogueWithDraftViews(null);

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [expect.objectContaining({ code: 'INVALID_SNAPSHOT' })],
      });
      expect(await scenario.readSnapshot()).toEqual(source);
    } finally {
      await scenario.close();
    }
  });

  it('blocks duplicate view identities in the persisted Draft document', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      await scenario.seedHeadViews(tableViews());
      const source = await scenario.readSnapshot();

      const result = await scenario.catalogueWithDraftViews({
        ...tableViews(),
        views: [...tableViews().views, { ...tableViews().views[0] }],
      });

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [expect.objectContaining({ code: 'AMBIGUOUS_IDENTITY' })],
      });
      expect(await scenario.readSnapshot()).toEqual(source);
    } finally {
      await scenario.close();
    }
  });

  it('blocks duplicate persisted views rows for one table identity', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      await scenario.seedHeadViews(tableViews());
      const source = await scenario.readSnapshot();

      const result = await scenario.catalogueWithDuplicateDraftViewsRow();

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [expect.objectContaining({ code: 'AMBIGUOUS_IDENTITY' })],
      });
      expect(await scenario.readSnapshot()).toEqual(source);
    } finally {
      await scenario.close();
    }
  });
});
