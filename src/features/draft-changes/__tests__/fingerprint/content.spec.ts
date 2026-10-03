import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/snapshot/fingerprint';
import {
  fingerprintSnapshot,
  firstDraftRow,
  requiredBlob,
} from '../snapshot/support/fingerprint-fixtures';

describe('draft changes fingerprint content', () => {
  it('binds nested JSON when stored hashes stay the same', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    firstDraftRow(after).row.data = {
      nested: { value: 'changed' },
      array: [1, 2],
    };

    expect(firstDraftRow(after).row.hash).toBe(firstDraftRow(before).row.hash);
    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('binds nested metadata when stored hashes stay the same', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    firstDraftRow(after).row.meta = { labels: ['changed'] };

    expect(firstDraftRow(after).row.hash).toBe(firstDraftRow(before).row.hash);
    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('binds file size metadata', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    const blob = requiredBlob(firstDraftRow(after).row, 'blob-a');
    blob.size = BigInt(99);

    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('binds file availability metadata', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    const blob = requiredBlob(firstDraftRow(after).row, 'blob-b');
    blob.deletedAt = new Date('2025-02-01T00:00:00.000Z');

    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('binds readonly state', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    firstDraftRow(after).row.readonly = true;

    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('binds system table state', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    firstDraftRow(after).table.system = true;

    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('binds timestamp changes after native structuredClone', () => {
    const before = structuredClone(fingerprintSnapshot());
    const after = structuredClone(before);
    firstDraftRow(after).row.updatedAt = new Date('2025-03-01T00:00:00.000Z');

    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('preserves date values through native structuredClone', () => {
    const before = fingerprintSnapshot();

    expect(fingerprintDraftChangesSnapshot(structuredClone(before))).toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('does not mutate the snapshot input', () => {
    const before = fingerprintSnapshot();
    const pristine = structuredClone(before);

    fingerprintDraftChangesSnapshot(before);

    expect(before).toEqual(pristine);
  });
});
