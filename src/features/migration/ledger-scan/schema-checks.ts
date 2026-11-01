import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type {
  DamageShape,
  RowHashReason,
  UnledgeredDetail,
} from 'src/features/migration/queries/impl/scan-schema-ledger.query';
import type {
  ReplayedSlot,
  ReplayFailure,
} from 'src/features/share/ledger-replay/ledger-replay';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
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
  currentSlots: ReadonlyMap<string, ReplayedSlot> | undefined,
  tableId: string,
  schemaRow: SchemaRow | undefined,
): SchemaCheck {
  if (!currentSlots) {
    return { kind: 'unledgered', detail: { reason: 'noMigrationTable' } };
  }

  const slot = currentSlots.get(tableId);

  if (!slot) {
    return { kind: 'unledgered', detail: { reason: 'noLineage' } };
  }

  if (slot.brokenBy) {
    return {
      kind: 'unledgered',
      detail: { reason: 'brokenLineage', migrationId: slot.brokenBy.id },
    };
  }

  const lineage = slot.migrations[0]?.id ?? '';

  if (slot.failure) {
    return { kind: 'unreplayable', lineage, failure: slot.failure };
  }

  return {
    kind: 'replayed',
    lineage,
    slot,
    passes: reproducesSchemaRow(slot, schemaRow),
  };
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

function reproducesSchemaRow(
  { schema }: ReplayedSlot,
  schemaRow: SchemaRow | undefined,
): boolean {
  return (
    schema !== undefined &&
    schemaRow !== undefined &&
    schemasEqual(schema, schemaRow.schema)
  );
}
