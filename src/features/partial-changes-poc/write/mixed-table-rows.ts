import { TargetTable } from 'src/features/partial-changes-poc/assembly/target.types';
import type { ChangeOperation } from 'src/features/partial-changes-poc/partial-changes.types';
import {
  sideOf,
  TableVersion,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { NewRowVersion } from 'src/features/partial-changes-poc/write/version-writer.service';

export interface MixedTableRows {
  dropBaseVersionIds: string[];
  linkOtherVersionIds: string[];
  merged: NewRowVersion[];
}

export function editsDraftInPlace(
  draft: TableVersion,
  id: string | undefined,
): boolean {
  return !draft.readonly && (id === undefined || id === draft.id);
}

export function copiesLinks(
  target: Pick<TargetTable, 'table' | 'linkSide' | 'publicId'>,
  operation: ChangeOperation,
): boolean {
  const draft = target.table.pair.draft;
  if (operation === 'commit' || target.linkSide === 'head' || !draft) {
    return true;
  }
  return !editsDraftInPlace(draft, target.publicId);
}

export function splitMixedTableRows(target: TargetTable): MixedTableRows {
  const result: MixedTableRows = {
    dropBaseVersionIds: [],
    linkOtherVersionIds: [],
    merged: [],
  };

  for (const { row, outcome } of target.rows) {
    if (outcome.kind === 'base') {
      continue;
    }

    const base = sideOf(row.pair, target.linkSide);
    if (base) {
      result.dropBaseVersionIds.push(base.versionId);
    }

    if (outcome.kind === 'other') {
      result.linkOtherVersionIds.push(outcome.version.versionId);
    } else if (outcome.kind === 'merged') {
      result.merged.push({
        createdId: outcome.createdId,
        id: outcome.id,
        data: outcome.data,
        meta: outcome.columns.meta,
        hash: outcome.hash,
        schemaHash: outcome.schemaHash,
        createdAt: outcome.columns.createdAt,
        publishedAt: outcome.columns.publishedAt,
      });
    }
  }

  return result;
}
