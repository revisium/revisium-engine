import { createHash } from 'node:crypto';
import { ChangeCatalogue } from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import type { ChangeOperation } from 'src/features/partial-changes-poc/partial-changes.types';
import {
  ChangesSnapshot,
  RowVersion,
  TableVersion,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';

export interface FingerprintInput {
  operation: ChangeOperation;
  snapshot: ChangesSnapshot;
  catalogue: ChangeCatalogue;
  applied: ReadonlySet<string>;
  draftRowDigests: ReadonlyMap<string, string>;
}

export function computeFingerprint(input: FingerprintInput): string {
  const { snapshot, applied } = input;
  const hash = createHash('sha256');
  hash.update(
    `${input.operation}|${snapshot.headRevisionId}|${snapshot.draftRevisionId}`,
  );

  for (const key of [...applied].sort()) {
    hash.update(`\n${key}|${versionParts(input, key).join('|')}`);
  }

  return hash.digest('hex');
}

export function tablesWithMutableDraftRows(
  catalogue: ChangeCatalogue,
  applied: ReadonlySet<string>,
): Array<{ tableCreatedId: string; draftVersionId: string }> {
  return [...applied].flatMap((key) => {
    const unit = catalogue.units.get(key);
    const draft =
      unit?.kind === 'structure'
        ? catalogue.tables.get(unit.tableCreatedId)?.pair.draft
        : undefined;
    return draft && !draft.readonly
      ? [
          {
            tableCreatedId: unit?.tableCreatedId ?? '',
            draftVersionId: draft.versionId,
          },
        ]
      : [];
  });
}

function versionParts(input: FingerprintInput, key: string): string[] {
  const { catalogue } = input;
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
      input.draftRowDigests.get(unit.tableCreatedId) ?? '',
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

const rowParts = new WeakMap<RowVersion, string>();

function rowPart(version: RowVersion | undefined): string {
  if (!version) {
    return '-';
  }
  let part = rowParts.get(version);
  if (part === undefined) {
    part = `${version.versionId}:${version.id}:${version.hash}:${new Date(version.updatedAt).getTime()}`;
    rowParts.set(version, part);
  }
  return part;
}
