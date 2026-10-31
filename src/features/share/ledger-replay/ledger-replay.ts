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
import {
  NativeSchemaRules,
  patchValues,
  type SchemaRefs,
  type SchemaValidator,
} from './native-schema-rules';
import {
  ledgeredTableIdOf,
  TableSlots,
  type SlotStep,
  type TableSlot,
} from './table-slots';

export interface LedgerReplayInput {
  ledger: readonly Migration[];
  refs: SchemaRefs;
  validator: SchemaValidator;
  schemas?: ReadonlyMap<string, JsonSchema>;
}

export interface ReplayFailure {
  migrationId: string;
  step: Migration['changeType'];
  error: string;
}

export interface UnattributedFailure extends ReplayFailure {
  tableId: string;
}

export interface ReplayedSlot extends TableSlot {
  readonly schema?: JsonSchema;
  readonly failure?: ReplayFailure;
}

export interface ReplayedLedger {
  slots: readonly ReplayedSlot[];
  schemas: ReadonlyMap<string, JsonSchema>;
  unreplayable: ReadonlyMap<string, ReplayFailure>;
  unattributed: readonly UnattributedFailure[];
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
  refs,
  validator,
  schemas = new Map(),
}: LedgerReplayInput): ReplayedLedger {
  const replay = new LedgerReplay(
    new NativeSchemaRules(refs, validator),
    schemas,
  );

  for (const migration of ledger) {
    replay.apply(migration);
  }

  return replay.result();
}

class LedgerReplay {
  private readonly tableSlots: TableSlots;
  private readonly slotSchemas = new Map<TableSlot, SlotSchema>();
  private readonly unattributed: UnattributedFailure[] = [];

  constructor(
    private readonly rules: NativeSchemaRules,
    schemas: ReadonlyMap<string, JsonSchema>,
  ) {
    this.tableSlots = new TableSlots(schemas.keys());

    for (const [tableId, slot] of this.tableSlots.currentSlots()) {
      this.slotSchemas.set(slot, { schema: schemas.get(tableId) });
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
    this.validateSchema(tableId, schema);
    this.ensureValidTableId(tableId);
    this.ensureFree(tableId, step.displaced);
    this.rules.ensureValidFieldNames([schema]);

    this.slotSchemaOf(step.slot).schema = schema;
    this.taintIfDependent(tableId, step.slot, migration, [schema]);
  }

  private updateTable(migration: UpdateMigration, slot: TableSlot): void {
    const { tableId, patches } = migration;
    this.validatePatches(tableId, patches);
    const schema = this.rules.patchedSchema(
      this.existingSchema(slot, tableId),
      patches,
    );
    this.validateSchema(tableId, schema);
    this.rules.ensureRecordableChange(schema, patches);

    this.slotSchemaOf(slot).schema = schema;
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
    const referrerSchemas = this.referrerSchemasAfterRename(
      tableId,
      nextTableId,
    );
    const renamedIsTainted = this.isTainted(step.slot);

    for (const [referrer, schema] of referrerSchemas) {
      this.slotSchemaOf(referrer).schema = schema;

      if (renamedIsTainted && referrer !== step.slot) {
        this.taint(
          referrer,
          failureOf(migration, dependsOnUnreplayable(nextTableId)),
        );
      }
    }
  }

  private removeTable({ tableId }: RemoveMigration, slot: TableSlot): void {
    this.existingSchema(slot, tableId);
    this.ensureNotReferenced(tableId);
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

  private taintIfDependent(
    tableId: string,
    slot: TableSlot,
    migration: Migration,
    namedSchemas: JsonSchema[],
  ): void {
    const unreplayableTarget = namedSchemas
      .flatMap((schema) => this.rules.foreignKeysOf(schema))
      .find(
        (target) =>
          target !== tableId &&
          this.isTainted(this.tableSlots.currentSlot(target)),
      );

    if (unreplayableTarget) {
      this.taint(
        slot,
        failureOf(migration, dependsOnUnreplayable(unreplayableTarget)),
      );
    }
  }

  private validatePatches(tableId: string, patches: JsonPatch[]): void {
    this.rules.ensureValidPatches(patches);

    for (const value of patchValues(patches)) {
      this.validateSchema(tableId, value);
    }
  }

  private validateSchema(tableId: string, schema: JsonSchema): void {
    this.ensureReferencedTablesExist(tableId, schema);
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
    tableId: string,
    schema: JsonSchema,
  ): void {
    const missingTarget = this.rules
      .foreignKeysOf(schema)
      .find(
        (target) => target !== tableId && !this.tableSlots.currentSlot(target),
      );

    if (missingTarget) {
      throw new Error(`Foreign key target "${missingTarget}" does not exist`);
    }
  }

  private ensureNotReferenced(tableId: string): void {
    const referrerIds = this.currentTables()
      .filter(({ schema }) => this.references(schema, tableId))
      .map(({ tableId: referrerId }) => `"${referrerId}"`);

    if (referrerIds.length > 0) {
      throw new Error(
        `Table "${tableId}" is referenced by ${referrerIds.join(', ')}`,
      );
    }
  }

  private referrerSchemasAfterRename(
    tableId: string,
    nextTableId: string,
  ): Map<TableSlot, JsonSchema> {
    const referrerSchemas = new Map<TableSlot, JsonSchema>();

    for (const { slot, schema } of this.currentTables()) {
      if (this.references(schema, tableId)) {
        referrerSchemas.set(
          slot,
          this.rules.renamedForeignKeys(schema, tableId, nextTableId),
        );
      }
    }

    return referrerSchemas;
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

    if (failure) {
      return { ...slot, failure };
    }

    return { ...slot, schema };
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
