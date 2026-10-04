import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/snapshot/fingerprint';
import {
  fingerprintSnapshot,
  firstDraftRow,
  requiredTable,
} from '../snapshot/support/fingerprint-fixtures';

describe('draft changes fingerprint ordering', () => {
  it('ignores JSON object key order', () => {
    const before = fingerprintSnapshot();
    const reordered = structuredClone(before);
    const { row } = firstDraftRow(reordered);
    row.data = { array: [1, 2], nested: { value: 'same' } };
    row.meta = { labels: ['a', 'b'] };

    expect(fingerprintDraftChangesSnapshot(reordered)).toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('ignores table collection order', () => {
    const before = fingerprintSnapshot();
    const reordered = structuredClone(before);
    reordered.draft.tables.reverse();

    expect(fingerprintDraftChangesSnapshot(reordered)).toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('ignores row collection order', () => {
    const before = fingerprintSnapshot();
    const reordered = structuredClone(before);
    requiredTable(reordered).rows.reverse();

    expect(fingerprintDraftChangesSnapshot(reordered)).toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('ignores file collection order', () => {
    const before = fingerprintSnapshot();
    const reordered = structuredClone(before);
    firstDraftRow(reordered).row.fileBlobs.reverse();

    expect(fingerprintDraftChangesSnapshot(reordered)).toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('preserves JSON array order', () => {
    const before = fingerprintSnapshot();
    const reordered = structuredClone(before);
    firstDraftRow(reordered).row.data = {
      nested: { value: 'same' },
      array: [2, 1],
    };

    expect(fingerprintDraftChangesSnapshot(reordered)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });
});
