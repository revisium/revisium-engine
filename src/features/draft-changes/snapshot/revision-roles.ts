import { BadRequestException } from '@nestjs/common';
import type { Prisma } from 'src/__generated__/client';

export const REVISION_ROLE_SELECT = {
  id: true,
  isHead: true,
  isDraft: true,
  parentId: true,
} satisfies Prisma.RevisionSelect;

export type RevisionRole = Prisma.RevisionGetPayload<{
  select: typeof REVISION_ROLE_SELECT;
}>;

export interface RevisionRoles {
  head: RevisionRole;
  draft: RevisionRole;
}

export function resolveRevisionRoles(revisions: RevisionRole[]): RevisionRoles {
  const heads = revisions.filter(({ isHead }) => isHead);
  const drafts = revisions.filter(({ isDraft }) => isDraft);
  const head = heads[0];
  const draft = drafts[0];

  if (heads.length !== 1 || drafts.length !== 1 || !head || !draft) {
    throw new BadRequestException(
      'Branch must have exactly one Head and one Draft revision.',
    );
  }
  if (head.id === draft.id) {
    throw new BadRequestException('Head and Draft must be distinct revisions.');
  }
  if (draft.parentId !== head.id) {
    throw new BadRequestException(
      'Draft must have its branch Head as its parent.',
    );
  }

  return { head, draft };
}
