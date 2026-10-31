import {
  createJsonSchemaStore,
  getForeignKeyPatchesFromSchema,
  getForeignKeysFromSchema,
  SchemaTable,
} from '@revisium/schema-toolkit/lib';
import type {
  InitMigration,
  JsonPatch,
  JsonSchema,
  Migration,
  RemoveMigration,
  RenameMigration,
  UpdateMigration,
} from '@revisium/schema-toolkit/types';

export type SchemaRefs = Readonly<Record<string, JsonSchema>>;

export interface LedgerReplayInput {
  ledger: readonly Migration[];
  refs: SchemaRefs;
  schemas?: ReadonlyMap<string, JsonSchema>;
}

export interface ReplayFailure {
  migrationId: string;
  step: Migration['changeType'];
  error: string;
}

export interface ReplayedLedger {
  schemas: ReadonlyMap<string, JsonSchema>;
  unreplayable: ReadonlyMap<string, ReplayFailure>;
}

type TableState = { schema: JsonSchema } | { failure: ReplayFailure };

export function replayLedger({
  ledger,
  refs,
  schemas = new Map(),
}: LedgerReplayInput): ReplayedLedger {
  const replay = new LedgerReplay(refs, schemas);

  for (const migration of ledger) {
    replay.apply(migration);
  }

  return replay.result();
}

class LedgerReplay {
  private tables: Map<string, TableState>;

  constructor(
    private readonly refs: SchemaRefs,
    schemas: ReadonlyMap<string, JsonSchema>,
  ) {
    this.tables = new Map(
      [...schemas].map(([tableId, schema]) => [tableId, { schema }]),
    );
  }

  public apply(migration: Migration): void {
    try {
      this.applyStep(migration);
    } catch (error) {
      this.markUnreplayable(migration, error);
    }
  }

  public result(): ReplayedLedger {
    const schemas = new Map<string, JsonSchema>();
    const unreplayable = new Map<string, ReplayFailure>();

    for (const [tableId, table] of this.tables) {
      if ('failure' in table) {
        unreplayable.set(tableId, table.failure);
      } else {
        schemas.set(tableId, table.schema);
      }
    }

    return { schemas, unreplayable };
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

  private createTable({ tableId, schema }: InitMigration): void {
    this.ensureFree(tableId);
    this.ensureReferencedTablesExist(tableId, [schema]);

    this.tables.set(tableId, { schema });
  }

  private updateTable({ tableId, patches }: UpdateMigration): void {
    const schema = this.patchedSchema(this.replayedSchema(tableId), patches);
    this.ensureReferencedTablesExist(tableId, [
      ...patchValues(patches),
      schema,
    ]);

    this.tables.set(tableId, { schema });
  }

  private renameTable({ tableId, nextTableId }: RenameMigration): void {
    const table = this.existingTable(tableId);
    this.ensureFree(nextTableId);

    const tables = new Map(this.tables);
    tables.delete(tableId);
    tables.set(nextTableId, table);
    this.rewriteReferrers(tables, tableId, nextTableId);

    this.tables = tables;
  }

  private removeTable({ tableId }: RemoveMigration): void {
    this.existingTable(tableId);
    this.ensureNotReferenced(tableId);

    this.tables.delete(tableId);
  }

  private markUnreplayable(migration: Migration, error: unknown): void {
    const table = this.tables.get(migration.tableId);
    if (table && 'failure' in table) {
      return;
    }

    this.tables.set(migration.tableId, {
      failure: {
        migrationId: migration.id,
        step: migration.changeType,
        error: messageOf(error),
      },
    });
  }

  private existingTable(tableId: string): TableState {
    const table = this.tables.get(tableId);
    if (!table) {
      throw new Error(`Table "${tableId}" does not exist`);
    }

    return table;
  }

  private replayedSchema(tableId: string): JsonSchema {
    const table = this.existingTable(tableId);
    if ('failure' in table) {
      throw dependsOnUnreplayable(tableId);
    }

    return table.schema;
  }

  private ensureFree(tableId: string): void {
    const table = this.tables.get(tableId);
    if (!table) {
      return;
    }

    if ('failure' in table) {
      throw dependsOnUnreplayable(tableId);
    }

    throw new Error(`Table "${tableId}" already exists`);
  }

  private ensureReferencedTablesExist(
    tableId: string,
    schemas: JsonSchema[],
  ): void {
    const targets = new Set(
      schemas.flatMap((schema) => this.foreignKeysOf(schema)),
    );
    targets.delete(tableId);

    for (const target of targets) {
      const table = this.tables.get(target);
      if (!table) {
        throw new Error(`Foreign key target "${target}" does not exist`);
      }

      if ('failure' in table) {
        throw dependsOnUnreplayable(target);
      }
    }
  }

  private ensureNotReferenced(tableId: string): void {
    const referrerIds = [...this.tables]
      .filter(
        ([referrerId, table]) =>
          referrerId !== tableId &&
          'schema' in table &&
          this.references(table.schema, tableId),
      )
      .map(([referrerId]) => `"${referrerId}"`);

    if (referrerIds.length > 0) {
      throw new Error(
        `Table "${tableId}" is referenced by ${referrerIds.join(', ')}`,
      );
    }
  }

  private rewriteReferrers(
    tables: Map<string, TableState>,
    tableId: string,
    nextTableId: string,
  ): void {
    for (const [referrerId, table] of tables) {
      if ('schema' in table && this.references(table.schema, tableId)) {
        tables.set(referrerId, {
          schema: this.renamedForeignKeys(table.schema, tableId, nextTableId),
        });
      }
    }
  }

  private renamedForeignKeys(
    schema: JsonSchema,
    tableId: string,
    nextTableId: string,
  ): JsonSchema {
    const patches = getForeignKeyPatchesFromSchema(
      createJsonSchemaStore(schema, this.refs),
      { tableId, nextTableId },
    );

    return this.patchedSchema(schema, patches);
  }

  private patchedSchema(schema: JsonSchema, patches: JsonPatch[]): JsonSchema {
    const schemaTable = new SchemaTable(schema, this.refs);
    schemaTable.applyPatches(patches);

    return schemaTable.getSchema();
  }

  private references(schema: JsonSchema, tableId: string): boolean {
    return this.foreignKeysOf(schema).includes(tableId);
  }

  private foreignKeysOf(schema: JsonSchema): string[] {
    return getForeignKeysFromSchema(createJsonSchemaStore(schema, this.refs));
  }
}

function patchValues(patches: JsonPatch[]): JsonSchema[] {
  return patches.flatMap((patch) =>
    patch.op === 'add' || patch.op === 'replace' ? [patch.value] : [],
  );
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function dependsOnUnreplayable(tableId: string): Error {
  return new Error(`Depends on unreplayable table "${tableId}"`);
}
