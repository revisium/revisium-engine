import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/draft-changes.fingerprint';
import {
  fingerprintSnapshot,
  firstDraftRow,
} from './support/fingerprint-fixtures';

describe('draft changes fingerprint identity', () => {
  it('binds Head and Draft roles and their relationship', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    after.draft.parentId = 'other-head';

    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('binds branch identity', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    after.branch.projectId = 'other-project';

    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('binds row version identity', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    firstDraftRow(after).row.versionId = 'different-row-version';

    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('binds table membership', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    after.draft.tables = after.draft.tables.filter(
      ({ id }) => id !== 'products',
    );

    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('binds row logical identity', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    firstDraftRow(after).row.createdId = 'different-logical-row';

    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('binds table logical identity', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    firstDraftRow(after).table.createdId = 'different-logical-table';

    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('binds row membership', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    const { table } = firstDraftRow(after);
    table.rows = table.rows.filter(({ id }) => id !== 'product-1');

    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });

  it('binds file association membership', () => {
    const before = fingerprintSnapshot();
    const after = structuredClone(before);
    firstDraftRow(after).row.fileBlobs = [];

    expect(fingerprintDraftChangesSnapshot(after)).not.toBe(
      fingerprintDraftChangesSnapshot(before),
    );
  });
});
