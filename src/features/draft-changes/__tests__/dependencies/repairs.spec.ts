import { findReferenceRepair } from 'src/features/draft-changes/dependencies/reference-repairs';
import { givenGroupedForeignKeyRepair } from './support/reference-repair-scenario';

describe('draft changes candidate reference repairs', () => {
  it('keeps schema repair coordinates scoped to their referencing table', () => {
    const scenario = givenGroupedForeignKeyRepair({
      unrelatedSelectedTable: 'unrelated-table',
    });

    const result = findReferenceRepair(scenario.input);

    expect(result).toEqual({
      requirements: [
        {
          kind: 'schemaEffects',
          role: 'head',
          causeRef: scenario.expectedCause,
          tableCreatedId: 'source-table',
          effects: [{ historyIndex: 1, patchIndex: 0 }],
        },
      ],
    });
  });

  it('requires the exact FK retarget coordinate without grouped description edits', () => {
    const scenario = givenGroupedForeignKeyRepair();

    const result = findReferenceRepair(scenario.input);

    expect(result).toEqual({
      requirements: [
        {
          kind: 'schemaEffects',
          role: 'head',
          causeRef: scenario.expectedCause,
          tableCreatedId: 'source-table',
          effects: [{ historyIndex: 1, patchIndex: 0 }],
        },
      ],
    });
  });
});
