import { createHash } from 'node:crypto';
import type {
  DraftChangesCatalogueEntry,
  DraftChangesCatalogueScope,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';

const REFERENCE_HASH_LENGTH = 22;
const REFERENCE_PART_COUNT = 3;

export function uniqueEntries(
  entries: DraftChangesCatalogueEntry[],
): DraftChangesCatalogueEntry[] {
  const byRef = new Map(entries.map((entry) => [entry.ref.value, entry]));
  return [...byRef.values()];
}

export function attachChangeReferences(
  entries: DraftChangesCatalogueEntry[],
  scope: DraftChangesCatalogueScope,
): DraftChangesCatalogueEntry[] {
  const scopeToken = hash(JSON.stringify(scope));
  return entries.map((entry) => {
    const identity = {
      kind: entry.kind,
      target: entry.target,
      classification: entry.classification,
      path: entry.path,
      previousPath: entry.previousPath,
      effectRefs: entry.effectRefs,
    };
    return {
      ...entry,
      ref: { value: `dc1.${scopeToken}.${hash(JSON.stringify(identity))}` },
    };
  });
}

export function isStaleChangeReference(
  value: string,
  scope: DraftChangesCatalogueScope,
): boolean {
  const parts = value.split('.');
  if (parts.length !== REFERENCE_PART_COUNT || parts[0] !== 'dc1') {
    return false;
  }
  const token = parts[1];
  const entryHash = parts[2];
  if (
    !token ||
    !entryHash ||
    !isOpaqueHash(token) ||
    !isOpaqueHash(entryHash)
  ) {
    return false;
  }
  return token !== hash(JSON.stringify(scope));
}

function isOpaqueHash(value: string): boolean {
  return (
    value.length === REFERENCE_HASH_LENGTH && /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function hash(value: string): string {
  return createHash('sha256')
    .update(value)
    .digest('base64url')
    .slice(0, REFERENCE_HASH_LENGTH);
}
