import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type {
  DamageShape,
  UnledgeredDetail,
} from 'src/features/migration/queries/impl/scan-schema-ledger.query';
import type {
  ReplayedSlot,
  ReplayFailure,
} from 'src/features/share/ledger-replay/ledger-replay';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import type { RowHashCount } from './scan-revision-reader';

export interface SchemaRow {
  readonly tableId: string;
  readonly versionId: string;
  readonly hash: string;
  readonly schema: JsonSchema;
}

export type SchemaCheck =
  | { readonly kind: 'unledgered'; readonly detail: UnledgeredDetail }
  | { readonly kind: 'unreplayable'; readonly failure: ReplayFailure }
  | {
      readonly kind: 'replayed';
      readonly slot: ReplayedSlot;
      readonly passes: boolean;
    };

export type ReplayedCheck = Extract<SchemaCheck, { kind: 'replayed' }>;

export function schemaCheckOf(
  currentSlots: ReadonlyMap<string, ReplayedSlot> | undefined,
  schemaRow: SchemaRow,
): SchemaCheck {
  if (!currentSlots) {
    return { kind: 'unledgered', detail: { reason: 'noMigrationTable' } };
  }

  const slot = currentSlots.get(schemaRow.tableId);

  if (!slot) {
    return { kind: 'unledgered', detail: { reason: 'noLineage' } };
  }

  if (slot.brokenBy) {
    return {
      kind: 'unledgered',
      detail: { reason: 'brokenLineage', migrationId: slot.brokenBy.id },
    };
  }

  if (slot.failure) {
    return { kind: 'unreplayable', failure: slot.failure };
  }

  return {
    kind: 'replayed',
    slot,
    passes:
      slot.schema !== undefined && schemasEqual(slot.schema, schemaRow.schema),
  };
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
