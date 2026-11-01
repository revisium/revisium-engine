import type { Side } from 'src/features/partial-changes/catalogue/unit';

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

  public resolve(id: string, side?: Side): T | undefined {
    if (side === 'head') {
      return this.head.get(id);
    }

    return this.draft.get(id) ?? this.head.get(id);
  }

  public holding(id: string): T[] {
    return [...new Set([this.draft.get(id), this.head.get(id)])].filter(
      (entry): entry is T => entry !== undefined,
    );
  }
}
