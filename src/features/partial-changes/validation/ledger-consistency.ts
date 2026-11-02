import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { LedgerPlan } from 'src/features/partial-changes/assembly/ledger-plan';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import { publicIdsOf } from 'src/features/partial-changes/catalogue/public-id-groups';
import { isUnledgered } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { AppliedUnits } from 'src/features/partial-changes/plan/change-operation';
import type { PlanBlocker } from 'src/features/partial-changes/plan/plan-blocker';
import type { ChangesSnapshot } from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  type LedgerRole,
  type ResultingRole,
  resultingRolesOf,
  sourceRoleOf,
} from 'src/features/partial-changes/validation/ledger-roles';
import { schemaRowOf } from 'src/features/share/ledger/migration-ledger';
import type {
  ReplayedLedger,
  ReplayedSlot,
} from 'src/features/share/ledger-replay/ledger-replay';
import type { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
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

export interface SlotInconsistency {
  readonly lineage: string;
  readonly tableId: string;
  readonly inconsistency: Inconsistency;
}

interface UnledgeredLineages {
  readonly tableIds: ReadonlySet<string>;
  readonly steps: ReadonlySet<string>;
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
    source: AssemblySource,
    choice: AppliedUnits,
    ledger: LedgerPlan,
  ): PlanBlocker[] {
    const sourceInconsistencies = this.sourceInconsistenciesOf(source.snapshot);

    return resultingRolesOf(source, choice, ledger).flatMap((role) =>
      sourceInconsistencies
        .newInconsistenciesOf({
          ...role,
          replayed: this.replayer.replay(role.ledger),
        })
        .map((found) => ledgerInconsistentOf(role, found)),
    );
  }

  public sourceInconsistenciesOf(
    snapshot: ChangesSnapshot,
  ): SourceInconsistencies {
    return new SourceInconsistencies(
      snapshot,
      this.replayOf(sourceRoleOf(snapshot, 'head')),
      this.replayOf(sourceRoleOf(snapshot, 'draft')),
    );
  }

  private replayOf(role: LedgerRole): ReplayedRole {
    return {
      ...role,
      replayed: this.replayer.replay(role.ledger),
    };
  }
}

export class SourceInconsistencies {
  private readonly unledgered: UnledgeredLineages;
  private readonly existing: ExistingInconsistencies;

  constructor(
    snapshot: ChangesSnapshot,
    head: ReplayedRole,
    draft: ReplayedRole,
  ) {
    this.unledgered = unledgeredLineagesOf(snapshot, head, draft);
    this.existing = {
      head: keysOf(inconsistenciesOf(head, this.unledgered)),
      draft: keysOf(inconsistenciesOf(draft, this.unledgered)),
    };
  }

  public newInconsistenciesOf(
    role: ReplayedResultingRole,
  ): SlotInconsistency[] {
    return inconsistenciesOf(role, this.unledgered).filter(
      (found) => !keepsExisting(role, this.existing, found),
    );
  }
}

function unledgeredLineagesOf(
  snapshot: ChangesSnapshot,
  head: ReplayedRole,
  draft: ReplayedRole,
): UnledgeredLineages {
  const tableIds = new Set(
    snapshot.tables
      .filter((pair) =>
        isUnledgered(pair, head.replayed.slots, draft.replayed.slots),
      )
      .flatMap(publicIdsOf),
  );
  const lineages = [head, draft]
    .flatMap(({ replayed }) => replayed.slots)
    .filter(
      ({ brokenBy, tableIds: slotTableIds }) =>
        brokenBy !== undefined && slotTableIds.some((id) => tableIds.has(id)),
    );

  return {
    tableIds,
    steps: new Set(
      lineages.flatMap(({ migrations }) => migrations.map(({ id }) => id)),
    ),
  };
}

function inconsistenciesOf(
  role: ReplayedRole,
  unledgered: UnledgeredLineages,
): SlotInconsistency[] {
  const schemas = schemasByTableId(role.schemaRows);
  const leftOut = new LeftOutSlots(role, unledgered);

  return role.replayed.slots
    .filter((slot) => !leftOut.has(slot))
    .flatMap((slot) => slotInconsistenciesOf(slot, schemas));
}

class LeftOutSlots {
  private readonly slots = new Set<ReplayedSlot>();
  private readonly tableIds: Set<string>;

  constructor(
    private readonly role: ReplayedRole,
    unledgered: UnledgeredLineages,
  ) {
    this.tableIds = new Set(unledgered.tableIds);

    for (const slot of role.replayed.slots) {
      if (followsAnyStep(slot, unledgered.steps)) {
        this.add(slot);
      }
    }

    this.addFailuresOfReadingOnlyLeftOutTables();
  }

  public has(slot: ReplayedSlot): boolean {
    return this.slots.has(slot);
  }

  private addFailuresOfReadingOnlyLeftOutTables(): void {
    const failed = failedSlotsInLedgerOrder(this.role);
    const failedTableIds = tableIdsOf(failed);
    const heldTableIds = tableIdsOf(this.role.replayed.slots);
    const readsByStep = readTableIdsByStep(this.role.replayed);
    const isUnreplayable = (tableId: string) =>
      failedTableIds.has(tableId) || !heldTableIds.has(tableId);

    for (const slot of failed) {
      const unreplayableReads = (
        readsByStep.get(failingStepOf(slot)) ?? []
      ).filter(isUnreplayable);

      if (this.areAllLeftOut(unreplayableReads)) {
        this.add(slot);
      }
    }
  }

  private areAllLeftOut(tableIds: readonly string[]): boolean {
    return (
      tableIds.length > 0 &&
      tableIds.every((tableId) => this.tableIds.has(tableId))
    );
  }

  private add(slot: ReplayedSlot): void {
    this.slots.add(slot);

    for (const tableId of slot.tableIds) {
      this.tableIds.add(tableId);
    }
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
    { lineage: lineageOf(slot), tableId: lastTableIdOf(slot), inconsistency },
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

  if (slot.schema === undefined || !schemasEqual(slot.schema, schema)) {
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

function followsAnyStep(
  { migrations, failure }: ReplayedSlot,
  steps: ReadonlySet<string>,
): boolean {
  return (
    migrations.some(({ id }) => steps.has(id)) ||
    (failure !== undefined && steps.has(failure.migrationId))
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

export function lineageOf({ migrations }: TableSlot): string {
  const [opening] = migrations;

  if (!opening) {
    throw new Error('A ledger slot was opened by no migration');
  }

  return opening.id;
}

function lastTableIdOf({ tableIds }: ReplayedSlot): string {
  const tableId = tableIds.at(-1);

  if (tableId === undefined) {
    throw new Error('A replayed ledger slot holds no table id');
  }

  return tableId;
}
