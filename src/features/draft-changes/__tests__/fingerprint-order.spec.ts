import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/draft-changes.fingerprint';
import {
  fingerprintSnapshot,
  firstDraftRow,
} from './support/fingerprint-fixtures';

describe('draft changes fingerprint ordering', () => {
  it('ignores object, table, and file collection order', () => {
    const before = fingerprintSnapshot();
    const reordered = structuredClone(before);
    reordered.draft.tables.reverse();
    const { row } = firstDraftRow(reordered);
    row.fileBlobs.reverse();
    row.data = { array: [1, 2], nested: { value: 'same' } };
    row.meta = { labels: ['a', 'b'] };

    expect(fingerprintDraftChangesSnapshot(before)).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintDraftChangesSnapshot(reordered)).toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('ignores row collection order', () => {
    const before = fingerprintSnapshot();
    const reordered = structuredClone(before);
    const table = reordered.draft.tables.find(({ id }) => id === 'products');
    if (!table) {
      throw new Error('Expected product table.');
    }
    table.rows.reverse();

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
