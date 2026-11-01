import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import type { RepairOutcome } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import {
  ledgerOf,
  migrationsOf,
} from 'src/features/share/ledger/migration-ledger';
import type { ReplayedLedger } from 'src/features/share/ledger-replay/ledger-replay';
import type { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import { isLedgered } from 'src/features/share/ledger-replay/table-slots';
import { DraftLedger } from './draft-ledger';
import { lastPublishedBoundsOf, type MigrationBounds } from './repair-ids';
import { type HistoryPatchesValidator, isNativeHistory } from './repair-patch';
import type { RepairState, RevisionLedger } from './repair-state-reader';

export interface StoredLedgerReplays {
  readonly head: ReplayedLedger;
  readonly draft: ReplayedLedger;
}

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
  private readonly draftLedger: DraftLedger;
  private readonly consistent: boolean;

  constructor(
    private readonly state: RepairState,
    private readonly replayer: LedgerReplayer,
    private readonly historyValidator: HistoryPatchesValidator,
    storedReplays: StoredLedgerReplays,
  ) {
    this.draftLedger = new DraftLedger(state);
    this.published = migrationsOf(this.draftLedger.published);
    this.pending = migrationsOf(this.draftLedger.pending);
    this.lastPublished = lastPublishedBoundsOf(this.draftLedger.published);
    this.headReplay = storedReplays.head;
    this.damagedTableIds = [...state.head.tableVersionIds.keys()].filter(
      (tableId) =>
        isLedgered(this.headReplay.slots, tableId) &&
        !this.replaysToHeadSchema(tableId),
    );
    this.headSchemaBaseline = replayer.replay(this.pending, {
      schemas: schemasOf(state.head),
    });
    this.passingDraftTableIds = this.draftTablesReproducedBy(
      storedReplays.draft,
    );
    this.baselineFailures = failingMigrationIdsOf(storedReplays.draft);
    this.consistent = this.draftLedger.isConsistent();
  }

  public replay(ledger: readonly Migration[]): ReplayedLedger {
    return this.replayer.replay(ledger);
  }

  public assess(tableId: string): TableAssessment {
    if (!isLedgered(this.headReplay.slots, tableId)) {
      return { outcome: 'unledgered' };
    }

    if (this.headReplay.unreplayable.has(tableId)) {
      return { outcome: 'ledgerDoesNotReplay' };
    }

    const draftTableId = this.draftLedger.draftTableIdOf(tableId);

    if (this.replaysToHeadSchema(tableId)) {
      return { outcome: this.draftDamageOf(draftTableId) };
    }

    if (!this.consistent || !this.hasNativeHistories(tableId)) {
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
    return this.draftLedger.reproducesDraftSchema(replay, draftTableId);
  }

  private hasNativeHistories(tableId: string): boolean {
    const histories = this.draftLedger.historiesOf(tableId);

    return (
      histories === undefined ||
      isNativeHistory(
        [...histories.inherited, ...histories.pending],
        this.historyValidator,
      )
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

  private draftTablesReproducedBy(replay: ReplayedLedger): Set<string> {
    const tableIds = [...this.state.draft.tableVersionIds.keys()];

    return new Set(
      tableIds.filter((tableId) => this.reproducesDraftSchema(replay, tableId)),
    );
  }
}

export function storedLedgerReplayOf(
  revision: RevisionLedger,
  replayer: LedgerReplayer,
): ReplayedLedger {
  return replayer.replay(migrationsOf(ledgerOf(revision.migrationRows)));
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
