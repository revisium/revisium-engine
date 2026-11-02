import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type {
  DamageShape,
  RowHashReason,
  UnledgeredDetail,
} from 'src/features/migration/queries/impl/scan-schema-ledger.query';
import type {
  ReplayedLedger,
  ReplayedSlot,
  ReplayFailure,
} from 'src/features/share/ledger-replay/ledger-replay';
import {
  checkTableSlot,
  lineageIdOf,
} from 'src/features/share/ledger-replay/slot-check';
import type { RowHashCount } from './scan-revision-reader';

export interface SchemaRow {
  readonly versionId: string;
  readonly hash: string;
  readonly schema: JsonSchema;
}

export type SchemaCheck =
  | { readonly kind: 'unledgered'; readonly detail: UnledgeredDetail }
  | {
      readonly kind: 'unreplayable';
      readonly lineage: string;
      readonly failure: ReplayFailure;
    }
  | {
      readonly kind: 'replayed';
      readonly lineage: string;
      readonly slot: ReplayedSlot;
      readonly passes: boolean;
    };

export type ReplayedCheck = Extract<SchemaCheck, { kind: 'replayed' }>;

export type SchemaHashing = (schema: JsonSchema) => string;

export function schemaCheckOf(
  replay: ReplayedLedger | undefined,
  tableId: string,
  schemaRow: SchemaRow | undefined,
): SchemaCheck {
  if (!replay) {
    return { kind: 'unledgered', detail: { reason: 'noMigrationTable' } };
  }

  const check = checkTableSlot(replay, tableId, schemaRow?.schema);

  switch (check.kind) {
    case 'unledgered':
      return { kind: 'unledgered', detail: check.reason };
    case 'unreplayable':
      return {
        kind: 'unreplayable',
        lineage: lineageIdOf(check.slot),
        failure: check.failure,
      };
    case 'mismatch':
    case 'reproduces':
      return {
        kind: 'replayed',
        lineage: lineageIdOf(check.slot),
        slot: check.slot,
        passes: check.kind === 'reproduces',
      };
  }
}

export function lineageOf(check: SchemaCheck): string | undefined {
  if (check.kind === 'unledgered') {
    return undefined;
  }

  return check.lineage;
}

export function passesSchemaCheck(check: SchemaCheck): boolean {
  return check.kind === 'replayed' && check.passes;
}

export function damageShapeOf(
  rowHashes: readonly RowHashCount[],
  schemaHash: string,
  replayedHash: string | undefined,
): DamageShape {
  const hashes = rowHashes.map(({ hash }) => hash);

  if (hashes.length > 0 && hashes.every((hash) => hash === schemaHash)) {
    return 'published';
  }

  if (
    replayedHash !== undefined &&
    hashes.includes(replayedHash) &&
    !hashes.includes(schemaHash)
  ) {
    return 'unpublished';
  }

  return 'unknown';
}

export function rowHashReasonOf(
  hash: string,
  { slot, passes }: ReplayedCheck,
  hashOf: SchemaHashing,
): RowHashReason {
  if (!passes && slot.schema !== undefined && hash === hashOf(slot.schema)) {
    return 'unmigratedByAsync';
  }

  const trail = slot.trail ?? [];
  const lastIndex = trail.map((step) => hashOf(step.schema)).lastIndexOf(hash);

  if (lastIndex < 0) {
    return 'unknownHash';
  }

  const ownStepFollows = trail
    .slice(lastIndex + 1)
    .some(({ cause }) => cause === 'ownStep');

  if (ownStepFollows) {
    return 'unmigratedRows';
  }

  return 'renamedReference';
}
