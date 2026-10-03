import { createHash } from 'node:crypto';
import { isDate } from 'node:util/types';
import type { DraftChangesFingerprintInput } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';

function compare(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function sortByIdentity<T extends { id: string; versionId?: string }>(
  values: readonly T[],
): T[] {
  return [...values].sort((left, right) => {
    return (
      compare(left.id, right.id) ||
      compare(left.versionId ?? '', right.versionId ?? '')
    );
  });
}

function normalizeCollections(
  snapshot: DraftChangesFingerprintInput,
): DraftChangesFingerprintInput {
  const normalizeRevision = (
    revision: DraftChangesFingerprintInput['head'],
  ): DraftChangesFingerprintInput['head'] => ({
    ...revision,
    tables: sortByIdentity(revision.tables).map((table) => ({
      ...table,
      rows: sortByIdentity(table.rows).map((row) => ({
        ...row,
        fileBlobs: sortByIdentity(row.fileBlobs),
      })),
    })),
  });

  return {
    branch: snapshot.branch,
    head: normalizeRevision(snapshot.head),
    draft: normalizeRevision(snapshot.draft),
  };
}

function encode(value: unknown): unknown {
  if (value === null) {
    return ['null'];
  }
  if (typeof value === 'object' && value !== null && isDate(value)) {
    return ['date', Date.prototype.toISOString.call(value)];
  }
  if (typeof value === 'bigint') {
    return ['bigint', value.toString()];
  }
  if (typeof value === 'string') {
    return ['string', value];
  }
  if (typeof value === 'boolean') {
    return ['boolean', value];
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Snapshot fingerprints require finite numbers.');
    }
    return ['number', Object.is(value, -0) ? '-0' : value.toString()];
  }
  if (Array.isArray(value)) {
    return ['array', value.map(encode)];
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compare(left, right))
      .map(([key, entry]) => [key, encode(entry)]);
    return ['object', entries];
  }
  throw new TypeError(
    `Unsupported snapshot fingerprint value: ${typeof value}`,
  );
}

export function fingerprintDraftChangesSnapshot(
  snapshot: DraftChangesFingerprintInput,
): string {
  const canonical = JSON.stringify(encode(normalizeCollections(snapshot)));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
