import {
  fingerprintSnapshot,
  firstDraftRow,
  normalizeRevisionRelations,
  requiredTable,
} from './support/fingerprint-fixtures';

describe('snapshot revision relation comparison', () => {
  it('ignores relation order without changing either revision', () => {
    const before = fingerprintSnapshot();
    const reordered = structuredClone(before);
    reordered.draft.tables.reverse();
    requiredTable(reordered).rows.reverse();
    firstDraftRow(reordered).row.fileBlobs.reverse();
    const originalOrder = structuredClone(reordered);

    expect(normalizeRevisionRelations(reordered.draft)).toEqual(
      normalizeRevisionRelations(before.draft),
    );
    expect(reordered).toEqual(originalOrder);
  });

  it('detects a changed row field', () => {
    const before = fingerprintSnapshot();
    const changed = structuredClone(before);
    firstDraftRow(changed).row.hash = 'changed-hash';

    expect(normalizeRevisionRelations(changed.draft)).not.toEqual(
      normalizeRevisionRelations(before.draft),
    );
  });

  it('detects a missing row', () => {
    const before = fingerprintSnapshot();
    const changed = structuredClone(before);
    requiredTable(changed).rows.pop();

    expect(normalizeRevisionRelations(changed.draft)).not.toEqual(
      normalizeRevisionRelations(before.draft),
    );
  });

  it('preserves semantic JSON array order', () => {
    const before = fingerprintSnapshot();
    const changed = structuredClone(before);
    firstDraftRow(changed).row.data = {
      nested: { value: 'same' },
      array: [2, 1],
    };

    expect(normalizeRevisionRelations(changed.draft)).not.toEqual(
      normalizeRevisionRelations(before.draft),
    );
  });
});
