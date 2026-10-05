import {
  createCandidateViewScenario,
  requireCatalogueEntry,
  requireNeedsEffects,
} from '../views/support/candidate-view-scenario';
import { addView, tableViews } from '../views/support/view-test-data';

describe('Draft Changes native default-view prerequisites', () => {
  it('requires the exact new-view ref when committing only its default change', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      await scenario.seedHeadViews(tableViews());
      const draftViews = {
        ...addView(tableViews(), 'compact', 'Compact'),
        defaultViewId: 'compact',
      };
      await scenario.updateDraftViews(draftViews);
      const defaultChange = requireCatalogueEntry(
        await scenario.viewConfigurationEntry('defaultViewId'),
      );
      const compactCreation = requireCatalogueEntry(
        await scenario.viewEntry('compact', 'lifecycle'),
      );

      const result = requireNeedsEffects(
        await scenario.resolveSelection('commit', {
          include: [{ kind: 'change', ref: defaultChange.ref }],
        }),
      );

      expect(result.requirements).toContainEqual(
        expect.objectContaining({
          role: 'head',
          causeRef: defaultChange.ref,
          refs: [compactCreation.ref],
        }),
      );
    } finally {
      await scenario.close();
    }
  });

  it('requires the exact default-change ref when discarding only its new view', async () => {
    const scenario = await createCandidateViewScenario();
    try {
      await scenario.seedHeadViews(tableViews());
      const draftViews = {
        ...addView(tableViews(), 'compact', 'Compact'),
        defaultViewId: 'compact',
      };
      await scenario.updateDraftViews(draftViews);
      const defaultChange = requireCatalogueEntry(
        await scenario.viewConfigurationEntry('defaultViewId'),
      );
      const compactCreation = requireCatalogueEntry(
        await scenario.viewEntry('compact', 'lifecycle'),
      );

      const result = requireNeedsEffects(
        await scenario.resolveSelection('discard', {
          include: [{ kind: 'change', ref: compactCreation.ref }],
        }),
      );

      expect(result.requirements).toContainEqual(
        expect.objectContaining({
          role: 'draft',
          causeRef: compactCreation.ref,
          refs: [defaultChange.ref],
        }),
      );
    } finally {
      await scenario.close();
    }
  });
});
