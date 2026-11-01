import type { Migration } from '@revisium/schema-toolkit/types';
import type { RenumberedMigration } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import type {
  ReplayedLedger,
  ReplayedSlot,
} from 'src/features/share/ledger-replay/ledger-replay';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import {
  NativeIdSequence,
  renumberedAfter,
  withRenumberedIds,
} from './repair-ids';
import type { RepairLedger } from './repair-ledger';
import { repairMigrationOf, type RepairPatch } from './repair-patch';

export interface RepairCandidate {
  readonly draftTableId: string;
  readonly patch: RepairPatch;
}

export interface Rejection {
  readonly outcome: 'blockedByDependency' | 'needsDraftStructureRevert';
  readonly blockedBy?: readonly string[];
}

export interface VerifiedPlan {
  readonly repairIds: ReadonlyMap<string, string>;
  readonly renumbered: readonly RenumberedMigration[];
  readonly rejections: ReadonlyMap<string, Rejection>;
}

const NEEDS_DRAFT_STRUCTURE_REVERT: Rejection = {
  outcome: 'needsDraftStructureRevert',
};

export function verifyCombinedPlan(
  ledger: RepairLedger,
  candidates: ReadonlyMap<string, RepairCandidate>,
  rejections: ReadonlyMap<string, Rejection> = new Map(),
): VerifiedPlan {
  if (candidates.size === 0) {
    return { repairIds: new Map(), renumbered: [], rejections };
  }

  const round = new PlanRound(ledger, candidates);
  const rejected = round.rejections();

  if (rejected.size === 0) {
    return {
      repairIds: round.repairIds,
      renumbered: round.renumbered,
      rejections,
    };
  }

  return verifyCombinedPlan(
    ledger,
    new Map([...candidates].filter(([tableId]) => !rejected.has(tableId))),
    new Map([...rejections, ...rejected]),
  );
}

class PlanRound {
  public readonly repairIds: ReadonlyMap<string, string>;
  public readonly renumbered: readonly RenumberedMigration[];
  private readonly previousIds: ReadonlyMap<string, string>;
  private readonly replay: ReplayedLedger;
  private readonly coupling: TableCoupling;

  constructor(
    private readonly ledger: RepairLedger,
    private readonly candidates: ReadonlyMap<string, RepairCandidate>,
  ) {
    const repairs = numberedRepairsOf(ledger, candidates);
    this.repairIds = new Map(repairs.map(({ tableId, id }) => [tableId, id]));
    this.renumbered = renumberedAfterRepairs(repairs, ledger.pending);
    this.previousIds = new Map(
      this.renumbered.map(({ previousId, id }) => [id, previousId]),
    );
    const pending = withRenumberedIds(ledger.pending, this.renumbered);

    this.replay = ledger.replay([...ledger.published, ...repairs, ...pending]);
    this.coupling = new TableCoupling(
      this.replay,
      new Set(pending.map(({ id }) => id)),
    );
  }

  public rejections(): Map<string, Rejection> {
    const rejections = new Map<string, Rejection>();

    for (const tableId of this.failingCandidates()) {
      rejections.set(tableId, this.rejectionOf(tableId));
    }

    const brokenTables = [
      ...this.brokenPassingTables(),
      ...this.newlyFailingTables(),
    ];
    for (const tableId of this.candidatesCoupledTo(brokenTables)) {
      if (!rejections.has(tableId)) {
        rejections.set(tableId, NEEDS_DRAFT_STRUCTURE_REVERT);
      }
    }

    if (rejections.size === 0 && brokenTables.length > 0) {
      throw new Error(
        `Repair planning broke ${brokenTables.join(', ')} without a coupled candidate`,
      );
    }

    return rejections;
  }

  private failingCandidates(): string[] {
    return [...this.candidates]
      .filter(
        ([, { draftTableId }]) =>
          !this.ledger.reproducesDraftSchema(this.replay, draftTableId),
      )
      .map(([tableId]) => tableId);
  }

  private brokenPassingTables(): string[] {
    return [...this.ledger.passingDraftTableIds].filter(
      (tableId) => !this.ledger.reproducesDraftSchema(this.replay, tableId),
    );
  }

  private newlyFailingTables(): string[] {
    return this.replay.slots
      .filter((slot) => this.failsNewly(slot) && !this.isCandidateSlot(slot))
      .flatMap(({ tableIds }) => tableIds);
  }

  private failsNewly({ failure }: ReplayedSlot): boolean {
    if (!failure) {
      return false;
    }

    const previousId = this.previousIds.get(failure.migrationId);

    return !this.ledger.baselineFailures.has(previousId ?? failure.migrationId);
  }

  private isCandidateSlot({ tableIds }: ReplayedSlot): boolean {
    return tableIds.some((tableId) => this.candidates.has(tableId));
  }

  private rejectionOf(tableId: string): Rejection {
    const blockedBy = this.ledger.damagedTableIds
      .filter(
        (damaged) =>
          !this.candidates.has(damaged) &&
          this.coupling.connects(tableId, damaged),
      )
      .sort(compareCodePoints);

    if (blockedBy.length === 0) {
      return NEEDS_DRAFT_STRUCTURE_REVERT;
    }

    return { outcome: 'blockedByDependency', blockedBy };
  }

  private candidatesCoupledTo(tableIds: readonly string[]): string[] {
    return [...this.candidates.keys()].filter((candidate) =>
      tableIds.some((tableId) => this.coupling.connects(candidate, tableId)),
    );
  }
}

function numberedRepairsOf(
  ledger: RepairLedger,
  candidates: ReadonlyMap<string, RepairCandidate>,
): Migration[] {
  const sequence = new NativeIdSequence(ledger.lastPublished);

  return [...candidates]
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([tableId, { patch }]) =>
      repairMigrationOf(tableId, patch, sequence.next()),
    );
}

function renumberedAfterRepairs(
  repairs: readonly Migration[],
  pending: readonly Migration[],
): RenumberedMigration[] {
  const lastRepair = repairs.at(-1);

  if (!lastRepair) {
    return [];
  }

  return renumberedAfter(lastRepair.id, pending);
}

class TableCoupling {
  private readonly parents = new Map<string, string>();

  constructor(
    replay: ReplayedLedger,
    pendingMigrationIds: ReadonlySet<string>,
  ) {
    for (const { tableIds } of replay.slots) {
      this.joinLineage(tableIds);
    }

    for (const { migrationId, tableId, readTableId } of replay.reads) {
      if (pendingMigrationIds.has(migrationId)) {
        this.join(tableId, readTableId);
      }
    }
  }

  public connects(left: string, right: string): boolean {
    return this.rootOf(left) === this.rootOf(right);
  }

  private joinLineage(tableIds: readonly string[]): void {
    const [lineageStart] = tableIds;

    for (const tableId of tableIds) {
      this.join(lineageStart ?? tableId, tableId);
    }
  }

  private join(left: string, right: string): void {
    const leftRoot = this.rootOf(left);
    const rightRoot = this.rootOf(right);

    if (leftRoot !== rightRoot) {
      this.parents.set(leftRoot, rightRoot);
    }
  }

  private rootOf(tableId: string): string {
    const parent = this.parents.get(tableId);

    if (parent === undefined) {
      return tableId;
    }

    return this.rootOf(parent);
  }
}
