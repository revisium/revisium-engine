import type { BranchScenarioTestKit } from 'src/__tests__/kit/create-branch-scenario-test-kit';
import type { JsonValue } from 'src/engine-prisma-types';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import type { BranchScenario } from 'src/__tests__/fixtures/branch-scenario';
import type { RevisionSide } from './snapshot-reading';

export interface ComparedColumns {
  readonly id: string;
  readonly hash: string;
  readonly schemaHash: string;
  readonly publishedAt: string;
  readonly meta: JsonValue;
}

export interface VersionedRow extends ComparedColumns {
  readonly versionId: string;
  readonly createdId: string;
  readonly data: JsonValue;
}

export interface VersionedTable {
  readonly versionId: string;
  readonly createdId: string;
  readonly rows: readonly VersionedRow[];
}

export async function comparedColumnsOf(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
  side: RevisionSide,
): Promise<Record<string, readonly ComparedColumns[]>> {
  const tables = await versionedContentsOf(kit, draft, side);

  return Object.fromEntries(
    Object.entries(tables).map(([tableId, { rows }]) => [
      tableId,
      rows.map(({ id, hash, schemaHash, publishedAt, meta }) => ({
        id,
        hash,
        schemaHash,
        publishedAt,
        meta,
      })),
    ]),
  );
}

export async function versionedContentsOf(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
  side: RevisionSide,
): Promise<Record<string, VersionedTable>> {
  const tables = await kit.prisma.table.findMany({
    where: { revisions: { some: { id: await draft.revisionId(side) } } },
    select: {
      id: true,
      versionId: true,
      createdId: true,
      rows: {
        select: {
          versionId: true,
          createdId: true,
          id: true,
          data: true,
          hash: true,
          schemaHash: true,
          publishedAt: true,
          meta: true,
        },
      },
    },
  });

  return Object.fromEntries(
    tables
      .sort((left, right) => compareCodePoints(left.id, right.id))
      .map(({ id, versionId, createdId, rows }) => [
        id,
        {
          versionId,
          createdId,
          rows: rows
            .map((row) => ({
              ...row,
              publishedAt: row.publishedAt.toISOString(),
            }))
            .sort((left, right) => compareCodePoints(left.id, right.id)),
        },
      ]),
  );
}
