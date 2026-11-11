import type { BranchScenario } from 'src/__tests__/fixtures/branch-scenario';
import type { BranchScenarioTestKit } from 'src/__tests__/kit/create-branch-scenario-test-kit';
import { FileUsageApiService } from 'src/features/file-usage/file-usage-api.service';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import type { RevisionSide } from './snapshot-reading';
import {
  type FileState,
  readFileStates,
} from 'src/__tests__/fixtures/file-states';

export interface RowFiles {
  readonly tableId: string;
  readonly rowId: string;
  readonly files: readonly string[];
}

// Blob ids belong to one project, so the accounting of twin branches in separate projects names files by hash.
export interface FileAccounting {
  readonly projectFileBytes: bigint;
  readonly files: Readonly<Record<string, FileState>>;
  readonly head: readonly RowFiles[];
  readonly draft: readonly RowFiles[];
}

export async function readFileAccounting(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
): Promise<FileAccounting> {
  const { projectId } = draft.branch;

  return {
    projectFileBytes: await kit.module
      .get(FileUsageApiService)
      .getProjectStorageBytes({ projectId }),
    files: await readFileStates(kit, projectId),
    head: await rowFilesOf(kit, draft, 'head'),
    draft: await rowFilesOf(kit, draft, 'draft'),
  };
}

export async function readFileReferences(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
): Promise<string[]> {
  const blobs = await kit.prisma.fileBlob.findMany({
    where: { projectId: draft.branch.projectId },
    select: { id: true, rows: { select: { versionId: true } } },
  });

  return blobs
    .flatMap(({ id, rows }) =>
      rows.map(({ versionId }) => `${id}/${versionId}`),
    )
    .sort(compareCodePoints);
}

async function rowFilesOf(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
  side: RevisionSide,
): Promise<RowFiles[]> {
  const tables = await kit.prisma.table.findMany({
    where: {
      system: false,
      revisions: { some: { id: await draft.revisionId(side) } },
    },
    select: {
      id: true,
      rows: {
        select: { id: true, fileBlobs: { select: { hash: true } } },
      },
    },
  });

  return tables
    .flatMap(({ id: tableId, rows }) =>
      rows.map(({ id: rowId, fileBlobs }) => ({
        tableId,
        rowId,
        files: fileBlobs.map(({ hash }) => hash).sort(compareCodePoints),
      })),
    )
    .sort(
      (left, right) =>
        compareCodePoints(left.tableId, right.tableId) ||
        compareCodePoints(left.rowId, right.rowId),
    );
}
