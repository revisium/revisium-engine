import objectHash from 'object-hash';
import {
  Direction,
  TargetTable,
} from 'src/features/partial-changes-poc/assembly/target.types';
import { sideOf } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { NewRowVersion } from 'src/features/partial-changes-poc/write/version-writer.service';

export interface MixedTableRows {
  dropBaseVersionIds: string[];
  linkOtherVersionIds: string[];
  merged: NewRowVersion[];
}

export function splitMixedTableRows(
  target: TargetTable,
  direction: Direction,
): MixedTableRows {
  const result: MixedTableRows = {
    dropBaseVersionIds: [],
    linkOtherVersionIds: [],
    merged: [],
  };
  const schemaHash = objectHash(target.table.schema ?? {});

  for (const { row, outcome } of target.rows) {
    if (outcome.kind === 'base') {
      continue;
    }

    const base = sideOf(row.pair, direction.base);
    if (base) {
      result.dropBaseVersionIds.push(base.versionId);
    }

    if (outcome.kind === 'other') {
      result.linkOtherVersionIds.push(outcome.version.versionId);
    } else if (outcome.kind === 'merged') {
      result.merged.push({
        createdId: row.pair.createdId,
        id: outcome.id,
        data: outcome.data,
        meta: outcome.base.meta,
        hash: outcome.hash,
        schemaHash,
        createdAt: outcome.base.createdAt,
        publishedAt: outcome.base.publishedAt,
      });
    }
  }

  return result;
}
