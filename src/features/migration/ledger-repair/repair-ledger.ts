import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import type { RepairOutcome } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import {
  hasIntactPublishedPrefix,
  type LedgerEntry,
  ledgerOf,
  splitLedger,
} from 'src/features/share/ledger/migration-ledger';
import {
  type AttributedSlot,
  attributePendingLedger,
} from 'src/features/share/ledger/pending-attribution';
import { pendingSchemaHistory } from 'src/features/share/ledger/schema-history';
import {
  type LedgerReplayInput,
  replayLedger,
  type ReplayedLedger,
} from 'src/features/share/ledger-replay/ledger-replay';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import { isLedgered } from 'src/features/share/ledger-replay/table-slots';
import { lastPublishedBoundsOf, type MigrationBounds } from './repair-ids';
import type { RepairState, RevisionLedger } from './repair-state-reader';

export type ReplayRules = Pick<LedgerReplayInput, 'refs' | 'validator'>;

export type TableAssessment =
  | { readonly outcome: RepairOutcome }
  | {
      readonly baseline: 'replayedSchema' | 'headSchema';
      readonly draftTableId: string;
    };

const NEEDS_DRAFT_STRUCTURE_REVERT: TableAssessment = {
  outcome: 'needsDraftStructureRevert',
};

export class RepairLedger {
  public readonly published: readonly Migration[];
  public readonly pending: readonly Migration[];
  public readonly lastPublished: MigrationBounds;
  public readonly damagedTableIds: readonly string[];
  public readonly passingDraftTableIds: ReadonlySet<string>;
  public readonly baselineFailures: ReadonlySet<string>;
  private readonly headReplay: ReplayedLedger;
  private readonly headSchemaBaseline: ReplayedLedger;
  private readonly attributedSlots: readonly AttributedSlot[];
  private readonly consistent: boolean;

  constructor(
    private readonly state: RepairState,
    public readonly rules: ReplayRules,
  ) {
    const { published, pending } = splitLedger(
      state.head.migrationRows,
      state.draft.migrationRows,
    );
    this.published = migrationsOf(published);
    this.pending = migrationsOf(pending);
    this.lastPublished = lastPublishedBoundsOf(published);
    this.headReplay = this.replay(this.published);
    this.damagedTableIds = [...state.head.tableVersionIds.keys()].filter(
      (tableId) =>
        isLedgered(this.headReplay.slots, tableId) &&
        !this.replaysToHeadSchema(tableId),
    );
    this.headSchemaBaseline = replayLedger({
      ledger: this.pending,
      schemas: schemasOf(state.head),
      ...rules,
    });
    const draftReplay = this.replay(
      migrationsOf(ledgerOf(state.draft.migrationRows)),
    );
    this.passingDraftTableIds = this.draftTablesReproducedBy(draftReplay);
    this.baselineFailures = failingMigrationIdsOf(draftReplay);
    this.attributedSlots = attributePendingLedger(
      this.pending,
      state.head.tableVersionIds.keys(),
      state.draft.tableVersionIds,
    );
    this.consistent =
      hasIntactPublishedPrefix(
        state.head.migrationRows,
        state.draft.migrationRows,
      ) &&
      this.attributedSlots.every(
        (attributed) =>
          attributed.owner.kind !== 'none' &&
          this.continuesHeadHistory(attributed),
      );
  }

  public replay(ledger: readonly Migration[]): ReplayedLedger {
    return replayLedger({ ledger, ...this.rules });
  }

  public assess(tableId: string): TableAssessment {
    if (!isLedgered(this.headReplay.slots, tableId)) {
      return { outcome: 'unledgered' };
    }

    if (this.headReplay.unreplayable.has(tableId)) {
      return { outcome: 'ledgerDoesNotReplay' };
    }

    const draftTableId = this.draftTableIdOf(tableId);

    if (this.replaysToHeadSchema(tableId)) {
      return { outcome: this.draftDamageOf(draftTableId) };
    }

    if (!this.consistent) {
      return { outcome: 'ledgerInconsistent' };
    }

    return this.baselineOf(draftTableId);
  }

  public replayedSchemaOf(tableId: string): JsonSchema | undefined {
    return this.headReplay.schemas.get(tableId);
  }

  public headSchemaOf(tableId: string): JsonSchema | undefined {
    return this.state.head.schemas.get(tableId)?.schema;
  }

  public reproducesDraftSchema(
    replay: ReplayedLedger,
    draftTableId: string,
  ): boolean {
    const replayed = replay.schemas.get(draftTableId);
    const stored = this.state.draft.schemas.get(draftTableId);

    return (
      replayed !== undefined &&
      stored !== undefined &&
      schemasEqual(replayed, stored.schema)
    );
  }

  private replaysToHeadSchema(tableId: string): boolean {
    const replayed = this.replayedSchemaOf(tableId);
    const headSchema = this.headSchemaOf(tableId);

    return (
      replayed !== undefined &&
      headSchema !== undefined &&
      schemasEqual(replayed, headSchema)
    );
  }

  private draftDamageOf(draftTableId: string | undefined): RepairOutcome {
    if (
      draftTableId === undefined ||
      this.passingDraftTableIds.has(draftTableId)
    ) {
      return 'notDamaged';
    }

    return 'draftOnlyDamage';
  }

  private baselineOf(draftTableId: string | undefined): TableAssessment {
    if (draftTableId === undefined) {
      return NEEDS_DRAFT_STRUCTURE_REVERT;
    }

    if (this.passingDraftTableIds.has(draftTableId)) {
      return { baseline: 'replayedSchema', draftTableId };
    }

    if (this.reproducesDraftSchema(this.headSchemaBaseline, draftTableId)) {
      return { baseline: 'headSchema', draftTableId };
    }

    return NEEDS_DRAFT_STRUCTURE_REVERT;
  }

  private draftTableIdOf(headTableId: string): string | undefined {
    const attributed = this.attributedSlots.find(
      ({ slot }) => slot.startingTableId === headTableId,
    );

    return attributed?.slot.currentTableId;
  }

  private draftTablesReproducedBy(replay: ReplayedLedger): Set<string> {
    const tableIds = [...this.state.draft.tableVersionIds.keys()];

    return new Set(
      tableIds.filter((tableId) => this.reproducesDraftSchema(replay, tableId)),
    );
  }

  private continuesHeadHistory({ slot, owner }: AttributedSlot): boolean {
    if (owner.kind !== 'headTable' || slot.currentTableId === undefined) {
      return true;
    }

    const headHistory =
      this.state.head.schemas.get(owner.tableId)?.history ?? [];
    const draftHistory =
      this.state.draft.schemas.get(slot.currentTableId)?.history ?? headHistory;

    return pendingSchemaHistory(headHistory, draftHistory).extendsHead;
  }
}

function migrationsOf(entries: readonly LedgerEntry[]): Migration[] {
  return entries.map(({ migration }) => migration);
}

function failingMigrationIdsOf(replay: ReplayedLedger): Set<string> {
  return new Set(
    replay.slots
      .map(({ failure }) => failure?.migrationId)
      .filter(
        (migrationId): migrationId is string => migrationId !== undefined,
      ),
  );
}

function schemasOf(revision: RevisionLedger): Map<string, JsonSchema> {
  return new Map(
    [...revision.schemas].map(([tableId, { schema }]) => [tableId, schema]),
  );
}
