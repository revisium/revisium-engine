import type {
  InitMigration,
  JsonPatch,
  JsonSchema,
  Migration,
  RemoveMigration,
  RenameMigration,
  UpdateMigration,
} from '@revisium/schema-toolkit/types';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import {
  replayLedger,
  type ReplayedLedger,
  type ReplayFailure,
} from 'src/features/share/ledger-replay/ledger-replay';

const UNCHECKED_HASH = '';

let migrationCount = 0;

export const refs = new JsonSchemaStoreService().refs;

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
  return replayLedger({ ledger, refs });
}

export function schemasOf(replay: ReplayedLedger) {
  return Object.fromEntries(replay.schemas);
}

export function unreplayableOf(replay: ReplayedLedger) {
  return Object.fromEntries(replay.unreplayable);
}

export function failure(migration: Migration, error: string): ReplayFailure {
  return { migrationId: migration.id, step: migration.changeType, error };
}

function nextMigrationId(): string {
  migrationCount += 1;
  return `migration-${migrationCount}`;
}

function fieldPath(name: string): string {
  return `/properties/${name}`;
}
