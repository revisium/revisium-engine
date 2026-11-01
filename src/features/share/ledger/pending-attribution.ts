import type { Migration } from '@revisium/schema-toolkit/types';
import {
  type TableSlot,
  traceTableSlots,
} from 'src/features/share/ledger-replay/table-slots';

export type PendingSlotOwner =
  | { readonly kind: 'headTable'; readonly tableId: string }
  | { readonly kind: 'draftTable'; readonly tableId: string }
  | { readonly kind: 'transient' }
  | { readonly kind: 'none' };

export interface AttributedSlot {
  readonly slot: TableSlot;
  readonly owner: PendingSlotOwner;
}

type TableIds = Pick<ReadonlySet<string>, 'has'>;

const TRANSIENT: PendingSlotOwner = { kind: 'transient' };
const NO_OWNER: PendingSlotOwner = { kind: 'none' };

export function attributePendingLedger(
  pending: readonly Migration[],
  headTableIds: Iterable<string>,
  draftTableIds: TableIds,
): AttributedSlot[] {
  return traceTableSlots(pending, headTableIds).map((slot) => ({
    slot,
    owner: ownerOf(slot, draftTableIds),
  }));
}

function ownerOf(slot: TableSlot, draftTableIds: TableIds): PendingSlotOwner {
  if (slot.brokenBy) {
    return NO_OWNER;
  }

  if (slot.startingTableId !== undefined) {
    return { kind: 'headTable', tableId: slot.startingTableId };
  }

  if (slot.currentTableId === undefined) {
    return TRANSIENT;
  }

  if (!draftTableIds.has(slot.currentTableId)) {
    return NO_OWNER;
  }

  return { kind: 'draftTable', tableId: slot.currentTableId };
}
