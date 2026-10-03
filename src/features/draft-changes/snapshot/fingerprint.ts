import { createHash } from 'node:crypto';
import type { DraftChangesFingerprintInput } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { canonicalValue, compareStrings } from './canonical-value';

function sortByIdentity<T extends { id: string; versionId?: string }>(
  values: readonly T[],
): T[] {
  return [...values].sort(
    (left, right) =>
      compareStrings(left.id, right.id) ||
      compareStrings(left.versionId ?? '', right.versionId ?? ''),
  );
}

function normalizeRow(
  row: DraftChangesFingerprintInput['head']['tables'][number]['rows'][number],
) {
  return { ...row, fileBlobs: sortByIdentity(row.fileBlobs) };
}

function normalizeTable(
  table: DraftChangesFingerprintInput['head']['tables'][number],
) {
  return {
    ...table,
    rows: sortByIdentity(table.rows).map(normalizeRow),
  };
}

function normalizeRevision(revision: DraftChangesFingerprintInput['head']) {
  return {
    ...revision,
    tables: sortByIdentity(revision.tables).map(normalizeTable),
  };
}

function normalizeSnapshot(snapshot: DraftChangesFingerprintInput) {
  return {
    branch: snapshot.branch,
    head: normalizeRevision(snapshot.head),
    draft: normalizeRevision(snapshot.draft),
  };
}

export function fingerprintDraftChangesSnapshot(
  snapshot: DraftChangesFingerprintInput,
): string {
  const canonical = JSON.stringify(canonicalValue(normalizeSnapshot(snapshot)));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
