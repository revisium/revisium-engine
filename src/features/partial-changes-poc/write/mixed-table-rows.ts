import { TargetTable } from 'src/features/partial-changes-poc/assembly/target.types';
import { sideOf } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { NewRowVersion } from 'src/features/partial-changes-poc/write/version-writer.service';

export interface MixedTableRows {
  dropBaseVersionIds: string[];
  linkOtherVersionIds: string[];
  merged: NewRowVersion[];
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
        meta: outcome.metaSource.meta,
        hash: outcome.hash,
        schemaHash: outcome.schemaHash,
        createdAt: outcome.metaSource.createdAt,
        publishedAt: outcome.metaSource.publishedAt,
      });
    }
  }

  return result;
}
