import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type {
  ReplayedLedger,
  ReplayedSlot,
  ReplayFailure,
} from './ledger-replay';
import { schemasEqual } from './schemas-equal';
import type { TableSlot } from './table-slots';

export type UnledgeredReason =
  | { readonly reason: 'noLineage' }
  | { readonly reason: 'brokenLineage'; readonly migrationId: string };

export type SlotCheck =
  | { readonly kind: 'unledgered'; readonly reason: UnledgeredReason }
  | {
      readonly kind: 'unreplayable';
      readonly slot: ReplayedSlot;
      readonly failure: ReplayFailure;
    }
  | { readonly kind: 'mismatch' | 'reproduces'; readonly slot: ReplayedSlot };

const NO_LINEAGE: SlotCheck = {
  kind: 'unledgered',
  reason: { reason: 'noLineage' },
};

export function checkTableSlot(
  replay: ReplayedLedger,
  tableId: string,
  schema: JsonSchema | undefined,
): SlotCheck {
  return checkSlot(replay.currentSlots.get(tableId), schema);
}

export function checkSlot(
  slot: ReplayedSlot | undefined,
  schema: JsonSchema | undefined,
): SlotCheck {
  if (!slot) {
    return NO_LINEAGE;
  }

  if (slot.brokenBy) {
    return {
      kind: 'unledgered',
      reason: { reason: 'brokenLineage', migrationId: slot.brokenBy.id },
    };
  }

  if (slot.failure) {
    return { kind: 'unreplayable', slot, failure: slot.failure };
  }

  if (!replaysTo(slot, schema)) {
    return { kind: 'mismatch', slot };
  }

  return { kind: 'reproduces', slot };
}

export function lineageIdOf({ migrations }: TableSlot): string {
  const [opening] = migrations;

  if (!opening) {
    throw new Error('A ledger slot was opened by no migration');
  }

  return opening.id;
}

function replaysTo(
  { schema: replayed }: ReplayedSlot,
  schema: JsonSchema | undefined,
): boolean {
  return (
    replayed !== undefined &&
    schema !== undefined &&
    schemasEqual(replayed, schema)
  );
}
