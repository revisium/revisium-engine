import type { JsonSchema } from '@revisium/schema-toolkit/types';
import {
  type ChangesSnapshot,
  publicTableIdOf,
  type TablePair,
  type TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { SourceReplays } from 'src/features/partial-changes/snapshot/source-replays';
import type { ReplayedLedger } from 'src/features/share/ledger-replay/ledger-replay';
import {
  checkTableSlot,
  type SlotCheck,
} from 'src/features/share/ledger-replay/slot-check';
import { isLedgered } from 'src/features/share/ledger-replay/table-slots';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

export type RefusalCode = 'headSchemaInconsistent' | 'unledgeredTable';

export interface RefusedTable {
  readonly tableId: string;
  readonly code: RefusalCode;
}

export interface HeadSchemaCheckInput {
  readonly snapshot: ChangesSnapshot;
  readonly replays: SourceReplays;
  readonly wholeDraft: boolean;
}

export interface HeadSchemaCheck {
  readonly refusedTables: readonly RefusedTable[];
  readonly refusedTablesByIdentity: ReadonlyMap<string, RefusedTable>;
  readonly replayedHeadSchemas: ReadonlyMap<string, JsonSchema>;
  readonly sourceReplays: SourceReplays;
}

interface Refusal {
  readonly identity: string;
  readonly table: RefusedTable;
}

export function checkHeadSchema(input: HeadSchemaCheckInput): HeadSchemaCheck {
  const refusals = refusalsOf(input);

  return {
    refusedTables: refusals.map(({ table }) => table),
    refusedTablesByIdentity: new Map(
      refusals.map(({ identity, table }) => [identity, table]),
    ),
    replayedHeadSchemas: replayedHeadSchemasOf(
      input.snapshot,
      input.replays.head,
    ),
    sourceReplays: input.replays,
  };
}

function refusalsOf(input: HeadSchemaCheckInput): Refusal[] {
  if (input.wholeDraft) {
    return [];
  }

  return new TableRefusals(input.replays)
    .of(input.snapshot.tables)
    .sort(byTableIdAndCode);
}

class TableRefusals {
  constructor(private readonly replays: SourceReplays) {}

  public of(pairs: readonly TablePair[]): Refusal[] {
    return pairs.flatMap((pair) => {
      const code = this.codeOf(pair);

      if (code === undefined) {
        return [];
      }

      return [
        {
          identity: pair.identity,
          table: { tableId: publicTableIdOf(pair), code },
        },
      ];
    });
  }

  private codeOf(pair: TablePair): RefusalCode | undefined {
    if (pair.head) {
      return headCodeOf(headCheckOf(pair.head, this.replays));
    }

    if (isUnledgered(pair, this.replays)) {
      return 'unledgeredTable';
    }

    return undefined;
  }
}

export function isUnledgered(pair: TablePair, replays: SourceReplays): boolean {
  if (pair.head) {
    return headCheckOf(pair.head, replays).kind === 'unledgered';
  }

  return !isLedgered(replays.draftSlots, publicTableIdOf(pair));
}

function headCheckOf(head: TableVersion, replays: SourceReplays): SlotCheck {
  return checkTableSlot(replays.head, head.id, head.schema);
}

function headCodeOf(check: SlotCheck): RefusalCode | undefined {
  switch (check.kind) {
    case 'unledgered':
      return 'unledgeredTable';
    case 'unreplayable':
    case 'mismatch':
      return 'headSchemaInconsistent';
    case 'reproduces':
      return undefined;
  }
}

function replayedHeadSchemasOf(
  snapshot: ChangesSnapshot,
  headLedger: ReplayedLedger,
): Map<string, JsonSchema> {
  const schemas = new Map<string, JsonSchema>();

  for (const { identity, head } of snapshot.tables) {
    const replayed = head && headLedger.schemas.get(head.id);

    if (replayed) {
      schemas.set(identity, replayed);
    }
  }

  return schemas;
}

function byTableIdAndCode(left: Refusal, right: Refusal): number {
  return (
    compareCodePoints(left.table.tableId, right.table.tableId) ||
    compareCodePoints(left.table.code, right.table.code)
  );
}
