import { createHash } from 'node:crypto';
import { ChangeCatalogue } from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import {
  ChangesSnapshot,
  RowVersion,
  TableVersion,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';

export function computeFingerprint(
  snapshot: ChangesSnapshot,
  catalogue: ChangeCatalogue,
  applied: ReadonlySet<string>,
): string {
  const hash = createHash('sha256');
  hash.update(`${snapshot.headRevisionId}|${snapshot.draftRevisionId}`);

  for (const key of [...applied].sort()) {
    hash.update(`\n${key}`);
    for (const part of versionParts(catalogue, key)) {
      hash.update(`|${part}`);
    }
  }

  return hash.digest('hex');
}

function versionParts(catalogue: ChangeCatalogue, key: string): string[] {
  const unit = catalogue.units.get(key);
  if (!unit) {
    return [];
  }

  const owned = (catalogue.ownedRows.get(key) ?? []).map(rowPart).sort();
  const table = catalogue.tables.get(unit.tableCreatedId);
  if (!table) {
    return owned;
  }

  if (unit.rowCreatedIds.length === 0) {
    return [
      tablePart(table.pair.head),
      tablePart(table.pair.draft),
      table.pair.rowsDigest ?? '',
      ...owned,
    ];
  }

  return unit.rowCreatedIds.flatMap((rowCreatedId) => {
    const pair = table.rows.get(rowCreatedId)?.pair;
    return [rowPart(pair?.head), rowPart(pair?.draft)];
  });
}

function tablePart(version: TableVersion | undefined): string {
  return version ? version.versionId : '-';
}

function rowPart(version: RowVersion | undefined): string {
  if (!version) {
    return '-';
  }
  return `${version.versionId}:${version.id}:${version.hash}:${new Date(version.updatedAt).toISOString()}`;
}
