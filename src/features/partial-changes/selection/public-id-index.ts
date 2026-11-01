import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { HeadQualifier } from 'src/features/partial-changes/catalogue/unit';

interface SidedVersions {
  readonly head?: { readonly id: string };
  readonly draft?: { readonly id: string };
}

export class PublicIdIndex<T> {
  private readonly draft = new Map<string, T>();
  private readonly head = new Map<string, T>();

  constructor(entries: readonly T[], versionsOf: (entry: T) => SidedVersions) {
    for (const entry of entries) {
      const { head, draft } = versionsOf(entry);

      if (draft) {
        this.draft.set(draft.id, entry);
      }

      if (head) {
        this.head.set(head.id, entry);
      }
    }
  }

  public resolve(id: string, side?: HeadQualifier): T | undefined {
    const found = resolveSide(side, (revisionSide) =>
      this.entriesOn(revisionSide).has(id),
    );

    return found && this.on(found, id);
  }

  public on(side: RevisionSide, id: string): T | undefined {
    return this.entriesOn(side).get(id);
  }

  private entriesOn(side: RevisionSide): ReadonlyMap<string, T> {
    if (side === 'head') {
      return this.head;
    }

    return this.draft;
  }
}

export function resolveSide(
  side: HeadQualifier | undefined,
  holds: (revisionSide: RevisionSide) => boolean,
): RevisionSide | undefined {
  if (side !== 'head' && holds('draft')) {
    return 'draft';
  }

  if (holds('head')) {
    return 'head';
  }

  return undefined;
}
