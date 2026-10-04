import { mergeRequiredEffects } from 'src/features/draft-changes/dependencies/dependency-effects';
import type { RequiredCandidateEffect } from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';

describe('Draft Changes required effect summaries', () => {
  it('keeps equal schema coordinates in different tables as distinct repairs', () => {
    const first = schemaRemoval('first-source');
    const second = schemaRemoval('second-source');

    expect(mergeRequiredEffects([first, second])).toEqual([first, second]);
  });
});

function schemaRemoval(tableCreatedId: string): RequiredCandidateEffect {
  return {
    kind: 'schemaEffects',
    role: 'head',
    causeRef: { value: 'target-deletion' },
    tableCreatedId,
    effects: [{ historyIndex: 1, patchIndex: 0 }],
  };
}
