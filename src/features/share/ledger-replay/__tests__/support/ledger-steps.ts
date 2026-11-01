import type {
  InitMigration,
  JsonPatch,
  JsonSchema,
  Migration,
  RemoveMigration,
  RenameMigration,
  UpdateMigration,
} from '@revisium/schema-toolkit/types';
import type { Cache } from '@nestjs/cache-manager';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import {
  replayLedger,
  type ReplayedLedger,
  type ReplayedSlot,
  type ReplayFailure,
  type TableRead,
  type UnattributedFailure,
} from 'src/features/share/ledger-replay/ledger-replay';

const UNCHECKED_HASH = '';
const SCHEMA_VALIDATION_USES_NO_CACHE = {} as Cache;

let migrationCount = 0;

export const refs = new JsonSchemaStoreService().refs;

export const validator = new JsonSchemaValidatorService(
  SCHEMA_VALIDATION_USES_NO_CACHE,
);

export function init(tableId: string, schema: JsonSchema): InitMigration {
  return {
    changeType: 'init',
    id: nextMigrationId(),
    tableId,
    hash: UNCHECKED_HASH,
    schema,
  };
}

export function update(tableId: string, patches: JsonPatch[]): UpdateMigration {
  return {
    changeType: 'update',
    id: nextMigrationId(),
    tableId,
    hash: UNCHECKED_HASH,
    patches,
  };
}

export function rename(tableId: string, nextTableId: string): RenameMigration {
  return { changeType: 'rename', id: nextMigrationId(), tableId, nextTableId };
}

export function remove(tableId: string): RemoveMigration {
  return { changeType: 'remove', id: nextMigrationId(), tableId };
}

export function addField(name: string, value: JsonSchema): JsonPatch {
  return { op: 'add', path: fieldPath(name), value };
}

export function removeField(name: string): JsonPatch {
  return { op: 'remove', path: fieldPath(name) };
}

export function replaceField(name: string, value: JsonSchema): JsonPatch {
  return { op: 'replace', path: fieldPath(name), value };
}

export function moveField(from: string, to: string): JsonPatch {
  return { op: 'move', from: fieldPath(from), path: fieldPath(to) };
}

export function replayOf(...ledger: Migration[]): ReplayedLedger {
  return replayLedger({ ledger, refs, validator });
}

export function schemasOf(replay: ReplayedLedger) {
  return Object.fromEntries(replay.schemas);
}

export function unreplayableOf(replay: ReplayedLedger) {
  return Object.fromEntries(replay.unreplayable);
}

export function unattributedOf(replay: ReplayedLedger) {
  return replay.unattributed;
}

export function slotOf(
  replay: ReplayedLedger,
  migration: Migration,
): ReplayedSlot | undefined {
  return replay.slots.find(({ migrations }) => migrations.includes(migration));
}

export function failure(migration: Migration, error: string): ReplayFailure {
  return { migrationId: migration.id, step: migration.changeType, error };
}

export function tableRead(
  migration: Migration,
  readTableId: string,
): TableRead {
  return { migrationId: migration.id, tableId: migration.tableId, readTableId };
}

export function unattributedFailure(
  migration: Migration,
  error: string,
): UnattributedFailure {
  return { tableId: migration.tableId, ...failure(migration, error) };
}

function nextMigrationId(): string {
  migrationCount += 1;
  return `migration-${migrationCount}`;
}

function fieldPath(name: string): string {
  return `/properties/${name}`;
}
