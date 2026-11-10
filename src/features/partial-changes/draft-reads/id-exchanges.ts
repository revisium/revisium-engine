import type { HeadIdHolderRow } from 'src/features/partial-changes/draft-reads/renamed-rows-sql';
import type { IdExchangeTermination } from 'src/features/partial-changes/queries/impl/draft-reads';
import type { RowPair } from 'src/features/partial-changes/snapshot/changes-snapshot';

export const LONGEST_LISTED_EXCHANGE = 50;

// A renamed row of a table: the Head id it left and the Draft id it took.
export interface RowRename {
  readonly identity: string;
  readonly headRowId: string;
  readonly draftRowId: string;
}

export interface RenameChain {
  readonly renames: readonly RowRename[];
  readonly termination: IdExchangeTermination;
}

type HeadIdHolding =
  | { readonly by: 'rename'; readonly rename: RowRename }
  | { readonly by: 'deletedRow' }
  | { readonly by: 'noRow' };

type WalkEnd =
  | { readonly termination: IdExchangeTermination }
  | { readonly unresolvedHeadRowId: string };

type WalkStep = { readonly next: RowRename } | WalkEnd;

type Walk = WalkEnd & { readonly renames: readonly RowRename[] };

const DELETED_ROW: HeadIdHolding = { by: 'deletedRow' };
const NO_ROW: HeadIdHolding = { by: 'noRow' };

// The id exchanges of the renamed rows of one table on a page. Each rename takes a Head id; the walk follows the row
// that held that id in Head, first among the rows the page loaded, then among the holders looked up for it.
export class TableIdExchanges {
  private readonly renames: readonly RowRename[];
  private readonly holdings = new Map<string, HeadIdHolding>();

  constructor(pairs: readonly RowPair[]) {
    this.renames = pairs.flatMap((pair) => renamesOf(pair));

    for (const rename of this.renames) {
      this.holdings.set(rename.headRowId, { by: 'rename', rename });
    }

    for (const { head, draft } of pairs) {
      if (head && !draft) {
        this.holdings.set(head.id, DELETED_ROW);
      }
    }
  }

  public unresolvedHeadRowIds(): string[] {
    const headRowIds = new Set<string>();

    for (const rename of this.renames) {
      const walk = this.walkFrom(rename);

      if ('unresolvedHeadRowId' in walk) {
        headRowIds.add(walk.unresolvedHeadRowId);
      }
    }

    return [...headRowIds];
  }

  public learnHolders(holders: readonly HeadIdHolderRow[]): void {
    for (const holder of holders) {
      this.holdings.set(holder.headRowId, holdingOf(holder));
    }
  }

  // The chain of each rename that takes the Head id of another renamed row, by the identity of its row.
  public chains(): Map<string, RenameChain> {
    const chains = new Map<string, RenameChain>();

    for (const rename of this.renames) {
      const walk = this.walkFrom(rename);

      if ('unresolvedHeadRowId' in walk) {
        throw new Error(
          `The id exchange of row ${rename.identity} reached ${walk.unresolvedHeadRowId}, which it did not look up`,
        );
      }

      if (walk.renames.length > 1) {
        chains.set(rename.identity, walk);
      }
    }

    return chains;
  }

  private walkFrom(start: RowRename): Walk {
    const renames = [start];
    let step = this.stepAfter(start, start, renames.length);

    while ('next' in step) {
      renames.push(step.next);
      step = this.stepAfter(start, step.next, renames.length);
    }

    return { ...step, renames };
  }

  private stepAfter(
    start: RowRename,
    current: RowRename,
    listed: number,
  ): WalkStep {
    const holding = this.holdings.get(current.draftRowId);

    if (!holding) {
      return { unresolvedHeadRowId: current.draftRowId };
    }

    if (holding.by === 'deletedRow') {
      return { termination: 'deletedOccupant' };
    }

    if (holding.by === 'noRow') {
      return { termination: 'freeId' };
    }

    if (holding.rename.identity === start.identity) {
      return { termination: 'cycle' };
    }

    if (listed === LONGEST_LISTED_EXCHANGE) {
      return { termination: 'truncated' };
    }

    return { next: holding.rename };
  }
}

function renamesOf({ identity, head, draft }: RowPair): RowRename[] {
  if (!head || !draft || head.id === draft.id) {
    return [];
  }

  return [{ identity, headRowId: head.id, draftRowId: draft.id }];
}

function holdingOf({
  headRowId,
  identity,
  draftRowId,
}: HeadIdHolderRow): HeadIdHolding {
  if (identity === null) {
    return NO_ROW;
  }

  if (draftRowId === null) {
    return DELETED_ROW;
  }

  if (draftRowId === headRowId) {
    throw new Error(
      `Row ${headRowId} holds its id in the Draft, which a rename takes`,
    );
  }

  return { by: 'rename', rename: { identity, headRowId, draftRowId } };
}
