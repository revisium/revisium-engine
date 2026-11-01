import type {
  InitMigration,
  JsonPatch,
  JsonSchema,
  Migration,
  RemoveMigration,
  RenameMigration,
  UpdateMigration,
} from '@revisium/schema-toolkit/types';
import { findTableIdError } from 'src/features/share/utils/validateUrlLikeId/table-id-error';
import { type NativeSchemaRules, patchValues } from './native-schema-rules';
import {
  ledgeredTableIdOf,
  TableSlots,
  type SlotStep,
  type TableSlot,
} from './table-slots';

export interface LedgerReplayInput {
  ledger: readonly Migration[];
  rules: NativeSchemaRules;
  schemas?: ReadonlyMap<string, JsonSchema>;
  recordTrail?: boolean;
}

export interface ReplayFailure {
  migrationId: string;
  step: Migration['changeType'];
  error: string;
}

export interface UnattributedFailure extends ReplayFailure {
  tableId: string;
}

export interface TableRead {
  migrationId: string;
  tableId: string;
  readTableId: string;
}

export interface SchemaTrailStep {
  readonly migrationId: string;
  readonly cause: 'ownStep' | 'referrerRewrite';
  readonly schema: JsonSchema;
}

export interface ReplayedSlot extends TableSlot {
  readonly schema?: JsonSchema;
  readonly failure?: ReplayFailure;
  readonly trail?: readonly SchemaTrailStep[];
}

export interface ReplayedLedger {
  slots: readonly ReplayedSlot[];
  schemas: ReadonlyMap<string, JsonSchema>;
  unreplayable: ReadonlyMap<string, ReplayFailure>;
  unattributed: readonly UnattributedFailure[];
  reads: readonly TableRead[];
}

interface SlotSchema {
  schema?: JsonSchema;
  failure?: ReplayFailure;
}

interface CurrentTable {
  tableId: string;
  slot: TableSlot;
  schema: JsonSchema;
}

export function replayLedger({
  ledger,
  rules,
  schemas = new Map(),
  recordTrail = false,
}: LedgerReplayInput): ReplayedLedger {
  const replay = new LedgerReplay(rules, schemas, recordTrail);

  for (const migration of ledger) {
    replay.apply(migration);
  }

  return replay.result();
}

class LedgerReplay {
  private readonly tableSlots: TableSlots;
  private readonly slotSchemas = new Map<TableSlot, SlotSchema>();
  private readonly unattributed: UnattributedFailure[] = [];
  private readonly reads: TableRead[] = [];
  private readonly trails?: Map<TableSlot, SchemaTrailStep[]>;

  constructor(
    private readonly rules: NativeSchemaRules,
    schemas: ReadonlyMap<string, JsonSchema>,
    recordTrail: boolean,
  ) {
    this.tableSlots = new TableSlots(schemas.keys());

    for (const [tableId, slot] of this.tableSlots.currentSlots()) {
      this.slotSchemas.set(slot, { schema: schemas.get(tableId) });
    }

    if (recordTrail) {
      this.trails = new Map();
    }
  }

  public apply(migration: Migration): void {
    const step = this.tableSlots.follow(migration);

    try {
      this.applyStep(migration, step);
    } catch (error) {
      this.recordFailure(
        migration,
        step,
        failureOf(migration, messageOf(error)),
      );
    }
  }

  public result(): ReplayedLedger {
    const slots = this.tableSlots.all().map((slot) => this.replayedSlot(slot));

    return {
      slots,
      ...ledgeredTablesOf(slots),
      unattributed: [...this.unattributed],
      reads: [...this.reads],
    };
  }

  private applyStep(migration: Migration, step: SlotStep): void {
    switch (migration.changeType) {
      case 'init':
        return this.createTable(migration, step);
      case 'update':
        return this.updateTable(migration, step.slot);
      case 'rename':
        return this.renameTable(migration, step);
      case 'remove':
        return this.removeTable(migration, step.slot);
    }
  }

  private createTable(migration: InitMigration, step: SlotStep): void {
    const { tableId, schema } = migration;
    this.validateSchema(migration, schema);
    this.ensureValidTableId(tableId);
    this.ensureFree(tableId, step.displaced);
    this.rules.ensureValidFieldNames([schema]);

    this.setSchema(step.slot, migration, 'ownStep', schema);
    this.taintIfDependent(tableId, step.slot, migration, [schema]);
  }

  private updateTable(migration: UpdateMigration, slot: TableSlot): void {
    const { tableId, patches } = migration;
    this.validatePatches(migration, patches);
    const schema = this.rules.patchedSchema(
      this.existingSchema(slot, tableId),
      patches,
    );
    this.validateSchema(migration, schema);
    this.rules.ensureRecordableChange(schema, patches);

    this.setSchema(slot, migration, 'ownStep', schema);
    this.taintIfDependent(tableId, slot, migration, [
      ...patchValues(patches),
      schema,
    ]);
  }

  private renameTable(migration: RenameMigration, step: SlotStep): void {
    const { tableId, nextTableId } = migration;
    this.existingSchema(step.slot, tableId);
    this.ensureValidTableId(nextTableId);
    this.ensureFree(nextTableId, step.displaced);
    const referrers = this.referrersOf(tableId);
    this.recordReads(
      migration,
      tableIdsOf(referrers.filter(({ slot }) => slot !== step.slot)),
    );
    const rewrittenReferrers = this.rewrittenAfterRename(
      referrers,
      tableId,
      nextTableId,
    );

    this.taintAcrossRename(migration, step.slot, rewrittenReferrers);
    for (const { slot, schema } of rewrittenReferrers) {
      this.setSchema(slot, migration, 'referrerRewrite', schema);
    }
  }

  private removeTable(migration: RemoveMigration, slot: TableSlot): void {
    this.existingSchema(slot, migration.tableId);
    this.ensureNotReferenced(migration);
  }

  private setSchema(
    slot: TableSlot,
    migration: Migration,
    cause: SchemaTrailStep['cause'],
    schema: JsonSchema,
  ): void {
    this.slotSchemaOf(slot).schema = schema;
    this.recordTrailStep(slot, { migrationId: migration.id, cause, schema });
  }

  private recordTrailStep(slot: TableSlot, step: SchemaTrailStep): void {
    if (!this.trails) {
      return;
    }

    const trail = this.trails.get(slot) ?? [];
    trail.push(step);
    this.trails.set(slot, trail);
  }

  private recordFailure(
    migration: Migration,
    step: SlotStep,
    failure: ReplayFailure,
  ): void {
    this.taint(step.slot, failure);

    if (!step.attributable) {
      this.unattributed.push({ tableId: migration.tableId, ...failure });
    }
  }

  private taint(slot: TableSlot, failure: ReplayFailure): void {
    const slotSchema = this.slotSchemaOf(slot);

    if (!slotSchema.failure) {
      slotSchema.failure = failure;
    }
  }

  private taintAcrossRename(
    migration: RenameMigration,
    renamed: TableSlot,
    referrers: CurrentTable[],
  ): void {
    const otherReferrers = referrers.filter(({ slot }) => slot !== renamed);
    const unreplayableReferrer = otherReferrers.find(({ slot }) =>
      this.isTainted(slot),
    );

    if (this.isTainted(renamed)) {
      for (const { slot } of otherReferrers) {
        this.taint(
          slot,
          failureOf(migration, dependsOnUnreplayable(migration.nextTableId)),
        );
      }
    }

    if (unreplayableReferrer) {
      this.taint(
        renamed,
        failureOf(
          migration,
          dependsOnUnreplayable(unreplayableReferrer.tableId),
        ),
      );
    }
  }

  private taintIfDependent(
    tableId: string,
    slot: TableSlot,
    migration: Migration,
    namedSchemas: JsonSchema[],
  ): void {
    const targets = this.foreignKeyTargetsOf(tableId, namedSchemas);
    this.recordReads(migration, targets);
    const unreplayableTarget = targets.find((target) =>
      this.isTainted(this.tableSlots.currentSlot(target)),
    );

    if (unreplayableTarget) {
      this.taint(
        slot,
        failureOf(migration, dependsOnUnreplayable(unreplayableTarget)),
      );
    }
  }

  private validatePatches(migration: Migration, patches: JsonPatch[]): void {
    this.rules.ensureValidPatches(patches);

    for (const value of patchValues(patches)) {
      this.validateSchema(migration, value);
    }
  }

  private validateSchema(migration: Migration, schema: JsonSchema): void {
    this.ensureReferencedTablesExist(migration, schema);
    this.rules.ensureValidSchema(schema);
  }

  private existingSchema(slot: TableSlot, tableId: string): JsonSchema {
    const schema = this.schemaOf(slot);
    if (!schema) {
      throw new Error(`Table "${tableId}" does not exist`);
    }

    return schema;
  }

  private ensureValidTableId(tableId: string): void {
    const error = findTableIdError(tableId);

    if (error) {
      throw new Error(error);
    }
  }

  private ensureFree(tableId: string, displaced: TableSlot | undefined): void {
    if (!displaced) {
      return;
    }

    if (this.isTainted(displaced)) {
      throw new Error(dependsOnUnreplayable(tableId));
    }

    throw new Error(`Table "${tableId}" already exists`);
  }

  private ensureReferencedTablesExist(
    migration: Migration,
    schema: JsonSchema,
  ): void {
    const missingTargets = this.foreignKeyTargetsOf(migration.tableId, [
      schema,
    ]).filter((target) => !this.tableSlots.currentSlot(target));
    const [missingTarget] = missingTargets;

    if (missingTarget !== undefined) {
      this.recordReads(migration, missingTargets);
      throw new Error(`Foreign key target "${missingTarget}" does not exist`);
    }
  }

  private ensureNotReferenced(migration: RemoveMigration): void {
    const referrers = this.referrersOf(migration.tableId);
    const referrerIds = tableIdsOf(referrers);
    this.recordReads(migration, referrerIds);

    if (referrerIds.length > 0) {
      const quotedIds = referrerIds.map((id) => `"${id}"`).join(', ');

      throw new Error(
        `Table "${migration.tableId}" is referenced by ${quotedIds}`,
      );
    }
  }

  private referrersOf(tableId: string): CurrentTable[] {
    return this.currentTables().filter(({ schema }) =>
      this.references(schema, tableId),
    );
  }

  private rewrittenAfterRename(
    referrers: CurrentTable[],
    tableId: string,
    nextTableId: string,
  ): CurrentTable[] {
    return referrers.map((referrer) => ({
      ...referrer,
      schema: this.rules.renamedForeignKeys(
        referrer.schema,
        tableId,
        nextTableId,
      ),
    }));
  }

  private foreignKeyTargetsOf(
    tableId: string,
    schemas: JsonSchema[],
  ): string[] {
    const targets = schemas
      .flatMap((schema) => this.rules.foreignKeysOf(schema))
      .filter((target) => target !== tableId);

    return [...new Set(targets)];
  }

  private recordReads(
    migration: Migration,
    readTableIds: readonly string[],
  ): void {
    for (const readTableId of readTableIds) {
      this.reads.push({
        migrationId: migration.id,
        tableId: migration.tableId,
        readTableId,
      });
    }
  }

  private references(schema: JsonSchema, tableId: string): boolean {
    return this.rules.foreignKeysOf(schema).includes(tableId);
  }

  private currentTables(): CurrentTable[] {
    const currentTables: CurrentTable[] = [];

    for (const [tableId, slot] of this.tableSlots.currentSlots()) {
      const schema = this.schemaOf(slot);

      if (schema) {
        currentTables.push({ tableId, slot, schema });
      }
    }

    return currentTables;
  }

  private schemaOf(slot: TableSlot): JsonSchema | undefined {
    return this.slotSchemas.get(slot)?.schema;
  }

  private isTainted(slot: TableSlot | undefined): boolean {
    return (
      slot !== undefined && this.slotSchemas.get(slot)?.failure !== undefined
    );
  }

  private slotSchemaOf(slot: TableSlot): SlotSchema {
    let slotSchema = this.slotSchemas.get(slot);

    if (!slotSchema) {
      slotSchema = {};
      this.slotSchemas.set(slot, slotSchema);
    }

    return slotSchema;
  }

  private replayedSlot(slot: TableSlot): ReplayedSlot {
    const { schema, failure } = this.slotSchemas.get(slot) ?? {};
    const trail = this.trailOf(slot);

    if (failure) {
      return { ...slot, failure, trail };
    }

    return { ...slot, schema, trail };
  }

  private trailOf(slot: TableSlot): SchemaTrailStep[] | undefined {
    if (!this.trails) {
      return undefined;
    }

    return [...(this.trails.get(slot) ?? [])];
  }
}

function ledgeredTablesOf(slots: readonly ReplayedSlot[]) {
  const schemas = new Map<string, JsonSchema>();
  const unreplayable = new Map<string, ReplayFailure>();

  for (const slot of slots) {
    const tableId = ledgeredTableIdOf(slot);

    if (tableId === undefined) {
      continue;
    }

    if (slot.failure) {
      unreplayable.set(tableId, slot.failure);
    } else if (slot.schema) {
      schemas.set(tableId, slot.schema);
    }
  }

  return { schemas, unreplayable };
}

function tableIdsOf(tables: readonly CurrentTable[]): string[] {
  return tables.map(({ tableId }) => tableId);
}

function failureOf(migration: Migration, error: string): ReplayFailure {
  return { migrationId: migration.id, step: migration.changeType, error };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function dependsOnUnreplayable(tableId: string): string {
  return `Depends on unreplayable table "${tableId}"`;
}
