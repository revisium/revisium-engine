import type { JsonSchema } from '@revisium/schema-toolkit/types';
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
import type { PlanBlocker } from 'src/features/partial-changes/plan/plan-blocker';
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

// Refused and unledgered tables, with the refusal that leaves each of their table
// ids and steps out (none for exactly `{ all: true }`, which refuses no table).
interface LeftOutLineages {
  readonly tableIds: ReadonlyMap<string, RefusedTable | undefined>;
  readonly steps: ReadonlyMap<string, RefusedTable | undefined>;
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

    return resultingRolesOf(source, choice, ledger).flatMap((role) =>
      sourceInconsistencies
        .newInconsistenciesOf({
          ...role,
          replayed: this.replayer.replay(role.ledger),
        })
        .map((found) => ledgerInconsistentOf(role, found)),
    );
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
  private readonly existing: ExistingInconsistencies;
  private readonly existingInEverySlot: ExistingInconsistencies;

  constructor(snapshot: ChangesSnapshot, headSchema: HeadSchemaCheck) {
    const replays = headSchema.sourceReplays;
    const head = replayedSourceRoleOf(snapshot, replays, 'head');
    const draft = replayedSourceRoleOf(snapshot, replays, 'draft');

    this.leftOut = leftOutLineagesOf(snapshot, headSchema);
    this.existing = {
      head: keysOf(inconsistenciesOf(head, this.leftOut)),
      draft: keysOf(inconsistenciesOf(draft, this.leftOut)),
    };
    this.existingInEverySlot = {
      head: keysOf(inconsistenciesOf(head, NOTHING_LEFT_OUT)),
      draft: keysOf(inconsistenciesOf(draft, NOTHING_LEFT_OUT)),
    };
  }

  public newInconsistenciesOf(
    role: ReplayedResultingRole,
  ): SlotInconsistency[] {
    return inconsistenciesOf(role, this.leftOut).filter(
      (found) => !keepsExisting(role, this.existing, found),
    );
  }

  // The refusals behind new inconsistencies that the comparison leaves out: a
  // step of a refused table, or a step that reads only refused tables, fails or
  // differs where the source role did not (§6.6). Exactly `{ all: true }` has
  // none.
  public refusalsOf(role: ReplayedResultingRole): RefusedTable[] {
    const schemas = schemasByTableId(role.schemaRows);
    const leftOut = new LeftOutSlots(role, this.leftOut);

    return role.replayed.slots.flatMap((slot) => {
      const refusal = leftOut.refusalOf(slot);

      if (!refusal) {
        return [];
      }

      return slotInconsistenciesOf(slot, schemas)
        .filter(
          (found) => !keepsExisting(role, this.existingInEverySlot, found),
        )
        .map(() => refusal);
    });
  }
}

const NOTHING_LEFT_OUT: LeftOutLineages = {
  tableIds: new Map(),
  steps: new Map(),
};

function replayedSourceRoleOf(
  snapshot: ChangesSnapshot,
  replays: SourceReplays,
  side: RevisionSide,
): ReplayedRole {
  return { ...sourceRoleOf(snapshot, side), replayed: replays[side] };
}

// Unledgered tables are left out with their broken lineages; refused ledgered
// tables (§6.10) with the lineages that hold them in the source revisions,
// including the ids those lineages held in between.
function leftOutLineagesOf(
  snapshot: ChangesSnapshot,
  { sourceReplays: replays, refusedTablesByIdentity }: HeadSchemaCheck,
): LeftOutLineages {
  const lineages = new LeftOutLineageSet();
  const unledgered = snapshot.tables.filter((pair) =>
    isUnledgered(pair, replays),
  );

  for (const pair of unledgered) {
    lineages.leaveOutTableIds(
      publicIdsOf(pair),
      refusedTablesByIdentity.get(pair.identity),
    );
  }

  for (const slot of lineages.brokenSlotsOf(replays)) {
    lineages.leaveOutSlot(slot, lineages.refusalOfAny(slot.tableIds));
  }

  for (const pair of snapshot.tables) {
    const refusal = refusedTablesByIdentity.get(pair.identity);

    if (refusal && !unledgered.includes(pair)) {
      for (const slot of sourceSlotsOf(pair, replays)) {
        lineages.leaveOutSlot(slot, refusal);
      }
    }
  }

  return lineages;
}

class LeftOutLineageSet implements LeftOutLineages {
  public readonly tableIds = new Map<string, RefusedTable | undefined>();
  public readonly steps = new Map<string, RefusedTable | undefined>();

  public leaveOutTableIds(
    tableIds: readonly string[],
    refusal: RefusedTable | undefined,
  ): void {
    for (const tableId of tableIds) {
      setIfAbsent(this.tableIds, tableId, refusal);
    }
  }

  public leaveOutSlot(
    { tableIds, migrations }: TableSlot,
    refusal: RefusedTable | undefined,
  ): void {
    this.leaveOutTableIds(tableIds, refusal);

    for (const { id } of migrations) {
      setIfAbsent(this.steps, id, refusal);
    }
  }

  public brokenSlotsOf(replays: SourceReplays): ReplayedSlot[] {
    return [replays.head, replays.draft]
      .flatMap(({ slots }) => slots)
      .filter(
        ({ brokenBy, tableIds }) =>
          brokenBy !== undefined &&
          tableIds.some((tableId) => this.tableIds.has(tableId)),
      );
  }

  public refusalOfAny(tableIds: readonly string[]): RefusedTable | undefined {
    return refusalOfAny(this.tableIds, tableIds);
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

function inconsistenciesOf(
  role: ReplayedRole,
  lineages: LeftOutLineages,
): SlotInconsistency[] {
  const schemas = schemasByTableId(role.schemaRows);
  const leftOut = new LeftOutSlots(role, lineages);

  return role.replayed.slots
    .filter((slot) => !leftOut.has(slot))
    .flatMap((slot) => slotInconsistenciesOf(slot, schemas));
}

class LeftOutSlots {
  private readonly slots = new Map<ReplayedSlot, RefusedTable | undefined>();
  private readonly tableIds: Map<string, RefusedTable | undefined>;

  constructor(
    private readonly role: ReplayedRole,
    lineages: LeftOutLineages,
  ) {
    this.tableIds = new Map(lineages.tableIds);

    for (const slot of role.replayed.slots) {
      const step = firstFollowedStep(slot, lineages.steps);

      if (step !== undefined) {
        this.add(slot, lineages.steps.get(step));
      }
    }

    this.addFailuresOfReadingOnlyLeftOutTables();
  }

  public has(slot: ReplayedSlot): boolean {
    return this.slots.has(slot);
  }

  public refusalOf(slot: ReplayedSlot): RefusedTable | undefined {
    return this.slots.get(slot);
  }

  private addFailuresOfReadingOnlyLeftOutTables(): void {
    const failed = failedSlotsInLedgerOrder(this.role);

    if (failed.length === 0) {
      return;
    }

    const failedTableIds = tableIdsOf(failed);
    const steps = new Map(this.role.ledger.map((step) => [step.id, step]));
    const timeline = new TableIdTimeline(this.role.ledger);
    const readsByStep = readTableIdsByStep(this.role.replayed);

    for (const slot of failed) {
      const step = steps.get(failingStepOf(slot));

      if (!step) {
        continue;
      }

      // A read fails the step when, at that step, its table failed or the
      // ledger holds no table under its id.
      const unreplayableReads = (readsByStep.get(step.id) ?? []).filter(
        (tableId) =>
          failedTableIds.has(tableId) ||
          timeline.lastChangeBefore(step, tableId)?.lineage === undefined,
      );

      if (this.areAllLeftOut(unreplayableReads)) {
        this.add(slot, refusalOfAny(this.tableIds, unreplayableReads));
      }
    }
  }

  private areAllLeftOut(tableIds: readonly string[]): boolean {
    return (
      tableIds.length > 0 &&
      tableIds.every((tableId) => this.tableIds.has(tableId))
    );
  }

  private add(slot: ReplayedSlot, refusal: RefusedTable | undefined): void {
    this.slots.set(slot, refusal);

    for (const tableId of slot.tableIds) {
      setIfAbsent(this.tableIds, tableId, refusal);
    }
  }
}

function refusalOfAny(
  refusals: ReadonlyMap<string, RefusedTable | undefined>,
  tableIds: readonly string[],
): RefusedTable | undefined {
  return tableIds
    .map((tableId) => refusals.get(tableId))
    .find((refusal) => refusal !== undefined);
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

function tableIdsOf(slots: readonly ReplayedSlot[]): Set<string> {
  return new Set(slots.flatMap(({ tableIds }) => tableIds));
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
