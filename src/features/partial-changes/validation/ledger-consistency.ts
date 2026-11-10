import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { LedgerPlan } from 'src/features/partial-changes/assembly/ledger-plan';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import { publicIdsOf } from 'src/features/partial-changes/catalogue/public-id-groups';
import {
  type HeadSchemaCheck,
  isUnledgered,
  type RefusedTable,
} from 'src/features/partial-changes/head-schema/head-schema-check';
import type { AppliedUnits } from 'src/features/partial-changes/plan/change-operation';
import {
  type PlanBlocker,
  refusalBlocker,
} from 'src/features/partial-changes/plan/plan-blocker';
import type {
  ChangesSnapshot,
  TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { SourceReplays } from 'src/features/partial-changes/snapshot/source-replays';
import {
  type LedgerRole,
  type ResultingRole,
  resultingRolesOf,
  sourceRoleOf,
} from 'src/features/partial-changes/validation/ledger-roles';
import { TableIdTimeline } from 'src/features/partial-changes/validation/table-id-timeline';
import { schemaRowOf } from 'src/features/share/ledger/migration-ledger';
import type {
  ReplayedLedger,
  ReplayedSlot,
} from 'src/features/share/ledger-replay/ledger-replay';
import type { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import {
  checkSlot,
  lineageIdOf,
} from 'src/features/share/ledger-replay/slot-check';
import {
  ledgeredTableIdOf,
  type TableSlot,
} from 'src/features/share/ledger-replay/table-slots';

type Inconsistency =
  | {
      readonly kind: 'unreplayable';
      readonly migrationId: string;
      readonly error: string;
    }
  | { readonly kind: 'schemaMismatch' }
  | { readonly kind: 'missingTable' };

export interface ValidationSource extends AssemblySource {
  readonly headSchema: HeadSchemaCheck;
}

export interface SlotInconsistency {
  readonly lineage: string;
  readonly tableId: string;
  readonly inconsistency: Inconsistency;
}

// The lineages of refused and unledgered tables in the source revisions, by
// opening migration, with their steps, and the ids of unledgered tables that no
// lineage holds; each with the refusal that leaves it out (none for exactly
// `{ all: true }`, which refuses no table).
interface LeftOutLineages {
  readonly lineages: ReadonlyMap<string, RefusedTable | undefined>;
  readonly steps: ReadonlyMap<string, RefusedTable | undefined>;
  readonly unledgeredTableIds: ReadonlyMap<string, RefusedTable | undefined>;
}

interface Cause {
  readonly leftOut: boolean;
  readonly refusal?: RefusedTable;
}

interface LeftOutInconsistency {
  readonly found: SlotInconsistency;
  readonly refusal?: RefusedTable;
}

export interface RoleAssessment {
  readonly inconsistencies: readonly SlotInconsistency[];
  readonly refusals: readonly RefusedTable[];
}

interface ReplayedRole extends LedgerRole {
  readonly replayed: ReplayedLedger;
}

export interface ReplayedResultingRole extends ResultingRole {
  readonly replayed: ReplayedLedger;
}

type ExistingInconsistencies = Readonly<
  Record<RevisionSide, ReadonlySet<string>>
>;

export class LedgerConsistency {
  constructor(private readonly replayer: LedgerReplayer) {}

  public blockersOf(
    source: ValidationSource,
    choice: AppliedUnits,
    ledger: LedgerPlan,
  ): PlanBlocker[] {
    const sourceInconsistencies = sourceInconsistenciesOf(source);

    return resultingRolesOf(source, choice, ledger).flatMap((role) => {
      const { inconsistencies, refusals } = sourceInconsistencies.assess({
        ...role,
        replayed: this.replayer.replay(role.ledger),
      });

      return [
        ...refusals.map(refusalBlocker),
        ...inconsistencies.map((found) => ledgerInconsistentOf(role, found)),
      ];
    });
  }
}

export function sourceInconsistenciesOf({
  snapshot,
  headSchema,
}: ValidationSource): SourceInconsistencies {
  return new SourceInconsistencies(snapshot, headSchema);
}

export class SourceInconsistencies {
  private readonly leftOut: LeftOutLineages;
  private readonly draftTimeline: TableIdTimeline;
  private readonly existing: ExistingInconsistencies;
  private readonly existingInEverySlot: ExistingInconsistencies;

  constructor(snapshot: ChangesSnapshot, headSchema: HeadSchemaCheck) {
    const replays = headSchema.sourceReplays;
    const head = replayedSourceRoleOf(snapshot, replays, 'head');
    const draft = replayedSourceRoleOf(snapshot, replays, 'draft');

    this.leftOut = leftOutLineagesOf(snapshot, headSchema);
    this.draftTimeline = new TableIdTimeline(draft.ledger);
    this.existing = {
      head: keysOf(this.leftOutSlotsOf(head).keptInconsistencies()),
      draft: keysOf(this.leftOutSlotsOf(draft).keptInconsistencies()),
    };
    this.existingInEverySlot = {
      head: keysOf(everyInconsistencyOf(head)),
      draft: keysOf(everyInconsistencyOf(draft)),
    };
  }

  // New inconsistencies that validation reports, and the refusals behind new
  // inconsistencies that it leaves out (§6.6): a lineage of a refused table, or
  // a step that fails only because of refused tables, fails or differs where
  // the source role did not.
  public assess(role: ReplayedResultingRole): RoleAssessment {
    const leftOut = this.leftOutSlotsOf(role);

    return {
      inconsistencies: leftOut
        .keptInconsistencies()
        .filter((found) => !keepsExisting(role, this.existing, found)),
      refusals: leftOut
        .leftOutInconsistencies()
        .filter(
          ({ found }) => !keepsExisting(role, this.existingInEverySlot, found),
        )
        .flatMap(({ refusal }) => (refusal ? [refusal] : [])),
    };
  }

  private leftOutSlotsOf(role: ReplayedRole): LeftOutSlots {
    return new LeftOutSlots(role, this.leftOut, this.draftTimeline);
  }
}

function replayedSourceRoleOf(
  snapshot: ChangesSnapshot,
  replays: SourceReplays,
  side: RevisionSide,
): ReplayedRole {
  return { ...sourceRoleOf(snapshot, side), replayed: replays[side] };
}

// Unledgered tables are left out with their broken lineages, refused ledgered
// tables (§6.10) with the lineages that hold them in the source revisions.
function leftOutLineagesOf(
  snapshot: ChangesSnapshot,
  { sourceReplays: replays, refusedTablesByIdentity }: HeadSchemaCheck,
): LeftOutLineages {
  const lineages = new LeftOutLineageSet();

  for (const pair of snapshot.tables) {
    const refusal = refusedTablesByIdentity.get(pair.identity);

    if (isUnledgered(pair, replays)) {
      lineages.leaveOutUnledgered(pair, replays, refusal);
    } else if (refusal) {
      for (const slot of sourceSlotsOf(pair, replays)) {
        lineages.leaveOutSlot(slot, refusal);
      }
    }
  }

  return lineages;
}

class LeftOutLineageSet implements LeftOutLineages {
  public readonly lineages = new Map<string, RefusedTable | undefined>();
  public readonly steps = new Map<string, RefusedTable | undefined>();
  public readonly unledgeredTableIds = new Map<
    string,
    RefusedTable | undefined
  >();

  public leaveOutUnledgered(
    pair: TablePair,
    replays: SourceReplays,
    refusal: RefusedTable | undefined,
  ): void {
    const tableIds = publicIdsOf(pair);

    for (const tableId of tableIds) {
      setIfAbsent(this.unledgeredTableIds, tableId, refusal);
    }

    for (const slot of [...replays.head.slots, ...replays.draft.slots]) {
      if (slot.brokenBy && slot.tableIds.some((id) => tableIds.includes(id))) {
        this.leaveOutSlot(slot, refusal);
      }
    }
  }

  public leaveOutSlot(
    slot: TableSlot,
    refusal: RefusedTable | undefined,
  ): void {
    setIfAbsent(this.lineages, lineageIdOf(slot), refusal);

    for (const { id } of slot.migrations) {
      setIfAbsent(this.steps, id, refusal);
    }
  }
}

function sourceSlotsOf(
  { head, draft }: TablePair,
  replays: SourceReplays,
): ReplayedSlot[] {
  return [
    head && replays.head.currentSlots.get(head.id),
    draft && replays.draft.currentSlots.get(draft.id),
  ].filter((slot): slot is ReplayedSlot => slot !== undefined);
}

function everyInconsistencyOf(role: ReplayedRole): SlotInconsistency[] {
  const schemas = schemasByTableId(role.schemaRows);

  return role.replayed.slots.flatMap((slot) =>
    slotInconsistenciesOf(slot, schemas),
  );
}

// The slots of a role that validation leaves out: those that follow a step of a
// left-out lineage, and those whose failing step failed only because of
// left-out tables, judged by what the role and the source Draft hold at that
// step. Each keeps the refusal that leaves it out.
class LeftOutSlots {
  private readonly slots = new Map<ReplayedSlot, RefusedTable | undefined>();
  private readonly schemas: ReadonlyMap<string, JsonSchema>;
  private readonly positions: ReadonlyMap<string, number>;
  private readonly slotsByLineage: ReadonlyMap<string, ReplayedSlot>;
  private timelineOfRole?: TableIdTimeline;
  private readsOfRole?: ReadonlyMap<string, readonly string[]>;

  constructor(
    private readonly role: ReplayedRole,
    private readonly lineages: LeftOutLineages,
    private readonly draftTimeline: TableIdTimeline,
  ) {
    this.schemas = schemasByTableId(role.schemaRows);
    this.positions = new Map(role.ledger.map(({ id }, index) => [id, index]));
    this.slotsByLineage = new Map(
      role.replayed.slots.map((slot) => [lineageIdOf(slot), slot]),
    );

    for (const slot of role.replayed.slots) {
      const step = firstFollowedStep(slot, lineages.steps);

      if (step !== undefined) {
        this.slots.set(slot, lineages.steps.get(step));
      }
    }

    for (const slot of failedSlotsInLedgerOrder(role)) {
      if (!this.slots.has(slot)) {
        this.leaveOutIfOnlyLeftOutCauses(slot);
      }
    }
  }

  public keptInconsistencies(): SlotInconsistency[] {
    return this.role.replayed.slots
      .filter((slot) => !this.slots.has(slot))
      .flatMap((slot) => slotInconsistenciesOf(slot, this.schemas));
  }

  public leftOutInconsistencies(): LeftOutInconsistency[] {
    return [...this.slots].flatMap(([slot, refusal]) =>
      slotInconsistenciesOf(slot, this.schemas).map((found) => ({
        found,
        refusal,
      })),
    );
  }

  private leaveOutIfOnlyLeftOutCauses(slot: ReplayedSlot): void {
    const step = this.role.ledger[this.positionOf(failingStepOf(slot))];

    if (!step) {
      return;
    }

    const causes = this.causesOf(step);

    if (causes.length > 0 && causes.every(({ leftOut }) => leftOut)) {
      this.slots.set(
        slot,
        causes.find(({ refusal }) => refusal !== undefined)?.refusal,
      );
    }
  }

  // The reads that the step could not resolve, and the id it takes when another
  // table holds it at that step.
  private causesOf(step: Migration): Cause[] {
    const reads = (this.readsByStep.get(step.id) ?? []).flatMap((tableId) =>
      this.readCauseOf(step, tableId),
    );
    const taken = takenTableIdOf(step);

    if (taken === undefined) {
      return reads;
    }

    const holder = this.timeline.lastChangeBefore(step, taken)?.lineage;

    return holder === undefined
      ? reads
      : [...reads, this.lineageCauseOf(holder)];
  }

  private readCauseOf(step: Migration, tableId: string): Cause[] {
    const lineage = this.timeline.lastChangeBefore(step, tableId)?.lineage;

    if (lineage === undefined) {
      return [this.meantCauseOf(step, tableId)];
    }

    const read = this.slotsByLineage.get(lineage);

    if (!read || !this.failedBefore(read, step)) {
      return [];
    }

    return [this.lineageCauseOf(lineage)];
  }

  // A read of an id the role does not hold at that step: what the source Draft
  // meant by it.
  private meantCauseOf(step: Migration, tableId: string): Cause {
    const meant = this.draftTimeline.includes(step)
      ? this.draftTimeline.lastChangeBefore(step, tableId)?.lineage
      : undefined;

    if (meant !== undefined) {
      return this.lineageCauseOf(meant);
    }

    return causeIn(this.lineages.unledgeredTableIds, tableId);
  }

  private lineageCauseOf(lineage: string): Cause {
    const slot = this.slotsByLineage.get(lineage);

    if (slot && this.slots.has(slot)) {
      return { leftOut: true, refusal: this.slots.get(slot) };
    }

    return causeIn(this.lineages.lineages, lineage);
  }

  private failedBefore(slot: ReplayedSlot, step: Migration): boolean {
    return (
      slot.failure !== undefined &&
      this.positionOf(slot.failure.migrationId) < this.positionOf(step.id)
    );
  }

  private positionOf(migrationId: string): number {
    return this.positions.get(migrationId) ?? -1;
  }

  private get timeline(): TableIdTimeline {
    this.timelineOfRole ??= new TableIdTimeline(this.role.ledger);

    return this.timelineOfRole;
  }

  private get readsByStep(): ReadonlyMap<string, readonly string[]> {
    this.readsOfRole ??= readTableIdsByStep(this.role.replayed);

    return this.readsOfRole;
  }
}

function causeIn(
  leftOut: ReadonlyMap<string, RefusedTable | undefined>,
  key: string,
): Cause {
  return { leftOut: leftOut.has(key), refusal: leftOut.get(key) };
}

function takenTableIdOf(migration: Migration): string | undefined {
  switch (migration.changeType) {
    case 'init':
      return migration.tableId;
    case 'rename':
      return migration.nextTableId;
    case 'update':
    case 'remove':
      return undefined;
  }
}

function setIfAbsent<V>(map: Map<string, V>, key: string, value: V): void {
  if (!map.has(key)) {
    map.set(key, value);
  }
}

function slotInconsistenciesOf(
  slot: ReplayedSlot,
  schemas: ReadonlyMap<string, JsonSchema>,
): SlotInconsistency[] {
  const inconsistency = inconsistencyOf(slot, schemas);

  if (!inconsistency) {
    return [];
  }

  return [
    { lineage: lineageIdOf(slot), tableId: lastTableIdOf(slot), inconsistency },
  ];
}

function inconsistencyOf(
  slot: ReplayedSlot,
  schemas: ReadonlyMap<string, JsonSchema>,
): Inconsistency | undefined {
  if (slot.failure) {
    const { migrationId, error } = slot.failure;

    return { kind: 'unreplayable', migrationId, error };
  }

  const tableId = ledgeredTableIdOf(slot);

  if (tableId === undefined) {
    return undefined;
  }

  const schema = schemas.get(tableId);

  if (schema === undefined) {
    return { kind: 'missingTable' };
  }

  if (checkSlot(slot, schema).kind === 'mismatch') {
    return { kind: 'schemaMismatch' };
  }

  return undefined;
}

function keepsExisting(
  role: ResultingRole,
  existing: ExistingInconsistencies,
  found: SlotInconsistency,
): boolean {
  return role.keepsInconsistenciesOf.some((side) =>
    existing[side].has(keyOf(found)),
  );
}

function keysOf(inconsistencies: readonly SlotInconsistency[]): Set<string> {
  return new Set(inconsistencies.map(keyOf));
}

function keyOf({ lineage, inconsistency }: SlotInconsistency): string {
  return JSON.stringify([lineage, inconsistency]);
}

function ledgerInconsistentOf(
  { name }: ResultingRole,
  { tableId, inconsistency }: SlotInconsistency,
): PlanBlocker {
  return {
    code: 'ledgerInconsistent',
    tableId,
    message: `The migration ledger of the ${name} ${problemOf(name, tableId, inconsistency)}`,
  };
}

function problemOf(
  role: string,
  tableId: string,
  inconsistency: Inconsistency,
): string {
  switch (inconsistency.kind) {
    case 'unreplayable':
      return `cannot replay ${tableId}: ${inconsistency.error}`;
    case 'schemaMismatch':
      return `does not replay to the schema of ${tableId}`;
    case 'missingTable':
      return `holds ${tableId}, which the ${role} does not have`;
  }
}

function firstFollowedStep(
  { migrations, failure }: ReplayedSlot,
  steps: ReadonlyMap<string, RefusedTable | undefined>,
): string | undefined {
  return [...migrations.map(({ id }) => id), failure?.migrationId].find(
    (id) => id !== undefined && steps.has(id),
  );
}

export function readTableIdsByStep({
  reads,
}: ReplayedLedger): ReadonlyMap<string, string[]> {
  const byStep = new Map<string, string[]>();

  for (const { migrationId, readTableId } of reads) {
    const tableIds = byStep.get(migrationId) ?? [];

    tableIds.push(readTableId);
    byStep.set(migrationId, tableIds);
  }

  return byStep;
}

function failedSlotsInLedgerOrder({
  ledger,
  replayed,
}: ReplayedRole): ReplayedSlot[] {
  const positions = new Map(ledger.map(({ id }, position) => [id, position]));
  const positionOf = (slot: ReplayedSlot) =>
    positions.get(failingStepOf(slot)) ?? 0;

  return replayed.slots
    .filter(({ failure }) => failure !== undefined)
    .sort((left, right) => positionOf(left) - positionOf(right));
}

function failingStepOf({ failure }: ReplayedSlot): string {
  if (!failure) {
    throw new Error(
      'A replayed ledger slot without a failure has no failing step',
    );
  }

  return failure.migrationId;
}

function schemasByTableId(
  schemaRows: readonly Row[],
): ReadonlyMap<string, JsonSchema> {
  return new Map(schemaRows.map((row) => [row.id, schemaRowOf(row).schema]));
}

function lastTableIdOf({ tableIds }: ReplayedSlot): string {
  const tableId = tableIds.at(-1);

  if (tableId === undefined) {
    throw new Error('A replayed ledger slot holds no table id');
  }

  return tableId;
}
