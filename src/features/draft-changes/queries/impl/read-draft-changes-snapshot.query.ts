import type { Prisma } from 'src/__generated__/client';

export const DRAFT_CHANGES_REVISION_INCLUDE = {
  tables: { include: { rows: { include: { fileBlobs: true } } } },
} satisfies Prisma.RevisionInclude;

export type DraftChangesRevisionSnapshot = Prisma.RevisionGetPayload<{
  include: typeof DRAFT_CHANGES_REVISION_INCLUDE;
}>;
export type DraftChangesBranchSnapshot =
  Prisma.BranchGetPayload<Prisma.BranchDefaultArgs>;

export interface ReadDraftChangesSnapshotQueryData {
  projectId: string;
  branchName: string;
}

export class ReadDraftChangesSnapshotQuery {
  constructor(public readonly data: ReadDraftChangesSnapshotQueryData) {}
}

export interface DraftChangesSnapshot {
  branch: DraftChangesBranchSnapshot;
  head: DraftChangesRevisionSnapshot;
  draft: DraftChangesRevisionSnapshot;
  fingerprint: string;
}

export type DraftChangesFingerprintInput = Omit<
  DraftChangesSnapshot,
  'fingerprint'
>;
