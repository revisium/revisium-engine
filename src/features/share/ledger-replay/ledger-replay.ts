import type {
  InitMigration,
  JsonPatch,
  JsonSchema,
  Migration,
  RemoveMigration,
  RenameMigration,
  UpdateMigration,
} from '@revisium/schema-toolkit/types';
import {
  NativeSchemaRules,
  patchValues,
  type SchemaRefs,
  type SchemaValidator,
} from './native-schema-rules';

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

export interface ReplayedLedger {
  schemas: ReadonlyMap<string, JsonSchema>;
  unreplayable: ReadonlyMap<string, ReplayFailure>;
  unattributed: readonly UnattributedFailure[];
}

interface TableSlot {
  schema: JsonSchema;
  failure?: ReplayFailure;
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
  private readonly slots: Map<string, TableSlot>;
  private readonly unattributed: UnattributedFailure[] = [];

  constructor(
    private readonly rules: NativeSchemaRules,
    schemas: ReadonlyMap<string, JsonSchema>,
  ) {
    this.slots = new Map(
      [...schemas].map(([tableId, schema]) => [tableId, { schema }]),
    );
  }

  public apply(migration: Migration): void {
    try {
      this.applyStep(migration);
    } catch (error) {
      this.recordFailure(migration, failureOf(migration, messageOf(error)));
    }
  }

  public result(): ReplayedLedger {
    const schemas = new Map<string, JsonSchema>();
    const unreplayable = new Map<string, ReplayFailure>();

    for (const [tableId, slot] of this.slots) {
      if (slot.failure) {
        unreplayable.set(tableId, slot.failure);
      } else {
        schemas.set(tableId, slot.schema);
      }
    }

    return { schemas, unreplayable, unattributed: [...this.unattributed] };
  }

  private applyStep(migration: Migration): void {
    switch (migration.changeType) {
      case 'init':
        return this.createTable(migration);
      case 'update':
        return this.updateTable(migration);
      case 'rename':
        return this.renameTable(migration);
      case 'remove':
        return this.removeTable(migration);
    }
  }

  private createTable(migration: InitMigration): void {
    const { tableId, schema } = migration;
    this.validateSchema(tableId, schema);
    this.ensureFree(tableId);
    this.rules.ensureValidFieldNames([schema]);

    const slot: TableSlot = { schema };
    this.slots.set(tableId, slot);
    this.taintIfDependent(tableId, slot, migration);
  }

  private updateTable(migration: UpdateMigration): void {
    const { tableId, patches } = migration;
    this.validatePatches(tableId, patches);
    const slot = this.existingSlot(tableId);
    const schema = this.rules.patchedSchema(slot.schema, patches);
    this.validateSchema(tableId, schema);
    this.rules.ensureRecordableChange(schema, patches);

    slot.schema = schema;
    this.taintIfDependent(tableId, slot, migration);
  }

  private renameTable(migration: RenameMigration): void {
    const { tableId, nextTableId } = migration;
    const renamed = this.existingSlot(tableId);
    this.ensureFree(nextTableId);
    const referrerSchemas = this.referrerSchemasAfterRename(
      tableId,
      nextTableId,
    );

    this.slots.delete(tableId);
    this.slots.set(nextTableId, renamed);
    for (const [referrer, schema] of referrerSchemas) {
      referrer.schema = schema;

      if (renamed.failure && referrer !== renamed) {
        this.taint(
          referrer,
          failureOf(migration, dependsOnUnreplayable(nextTableId)),
        );
      }
    }
  }

  private removeTable({ tableId }: RemoveMigration): void {
    this.existingSlot(tableId);
    this.ensureNotReferenced(tableId);

    this.slots.delete(tableId);
  }

  private recordFailure(migration: Migration, failure: ReplayFailure): void {
    const slot = this.slots.get(migration.tableId);

    if (slot) {
      this.taint(slot, failure);
    } else {
      this.unattributed.push({ tableId: migration.tableId, ...failure });
    }
  }

  private taint(slot: TableSlot, failure: ReplayFailure): void {
    if (!slot.failure) {
      slot.failure = failure;
    }
  }

  private taintIfDependent(
    tableId: string,
    slot: TableSlot,
    migration: Migration,
  ): void {
    const unreplayableTarget = this.rules
      .foreignKeysOf(slot.schema)
      .find((target) => target !== tableId && this.slots.get(target)?.failure);

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

  private existingSlot(tableId: string): TableSlot {
    const slot = this.slots.get(tableId);
    if (!slot) {
      throw new Error(`Table "${tableId}" does not exist`);
    }

    return slot;
  }

  private ensureFree(tableId: string): void {
    const slot = this.slots.get(tableId);
    if (!slot) {
      return;
    }

    if (slot.failure) {
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
      .find((target) => target !== tableId && !this.slots.has(target));

    if (missingTarget) {
      throw new Error(`Foreign key target "${missingTarget}" does not exist`);
    }
  }

  private ensureNotReferenced(tableId: string): void {
    const referrerIds = [...this.slots]
      .filter(
        ([referrerId, slot]) =>
          referrerId !== tableId && this.references(slot.schema, tableId),
      )
      .map(([referrerId]) => `"${referrerId}"`);

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

    for (const slot of this.slots.values()) {
      if (this.references(slot.schema, tableId)) {
        referrerSchemas.set(
          slot,
          this.rules.renamedForeignKeys(slot.schema, tableId, nextTableId),
        );
      }
    }

    return referrerSchemas;
  }

  private references(schema: JsonSchema, tableId: string): boolean {
    return this.rules.foreignKeysOf(schema).includes(tableId);
  }
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
