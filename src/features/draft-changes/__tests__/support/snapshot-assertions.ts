import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/snapshot/fingerprint';

export function expectUnchangedDraftSnapshot(
  before: DraftChangesSnapshot,
  after: DraftChangesSnapshot,
): void {
  expect(fingerprintDraftChangesSnapshot(after)).toBe(
    fingerprintDraftChangesSnapshot(before),
  );
  expect(after.fingerprint).toBe(before.fingerprint);
}
