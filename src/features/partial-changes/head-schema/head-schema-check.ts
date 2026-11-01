import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { publicTableIdOf } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { LedgerAttribution } from 'src/features/partial-changes/catalogue/ledger-attribution';
import type {
  ChangesSnapshot,
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  ledgerOf,
  migrationsOf,
} from 'src/features/share/ledger/migration-ledger';
import type { ReplayedLedger } from 'src/features/share/ledger-replay/ledger-replay';
import type { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import {
  isLedgered,
  type TableSlot,
  traceTableSlots,
} from 'src/features/share/ledger-replay/table-slots';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

export type RefusalCode = 'headSchemaInconsistent' | 'unledgeredTable';

export interface RefusedTable {
  readonly tableId: string;
  readonly code: RefusalCode;
}

export interface HeadSchemaCheckInput {
  readonly snapshot: ChangesSnapshot;
  readonly ledger: LedgerAttribution;
  readonly wholeDraft: boolean;
}

export interface HeadSchemaCheck {
  readonly refusedTables: readonly RefusedTable[];
  readonly refusedTablesByIdentity: ReadonlyMap<string, RefusedTable>;
  readonly replayedHeadSchemas: ReadonlyMap<string, JsonSchema>;
}

interface Refusal {
  readonly identity: string;
  readonly table: RefusedTable;
}

export function checkHeadSchema(
  input: HeadSchemaCheckInput,
  replayer: LedgerReplayer,
): HeadSchemaCheck {
  const headLedger = replayer.replay(migrationsOf(input.ledger.published));
  const refusals = refusalsOf(input, headLedger);

  return {
    refusedTables: refusals.map(({ table }) => table),
    refusedTablesByIdentity: new Map(
      refusals.map(({ identity, table }) => [identity, table]),
    ),
    replayedHeadSchemas: replayedHeadSchemasOf(input.snapshot, headLedger),
  };
}

function refusalsOf(
  input: HeadSchemaCheckInput,
  headLedger: ReplayedLedger,
): Refusal[] {
  if (input.wholeDraft) {
    return [];
  }

  const draftSlots = traceTableSlots(
    migrationsOf(ledgerOf(input.snapshot.systemRows.migrations.draft)),
  );

  return new TableRefusals(headLedger, draftSlots)
    .of(input.snapshot.tables)
    .sort(byTableIdAndCode);
}

class TableRefusals {
  constructor(
    private readonly headLedger: ReplayedLedger,
    private readonly draftSlots: readonly TableSlot[],
  ) {}

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
    if (isUnledgered(pair, this.headLedger.slots, this.draftSlots)) {
      return 'unledgeredTable';
    }

    if (pair.head && !this.replaysToSchemaRow(pair.head)) {
      return 'headSchemaInconsistent';
    }

    return undefined;
  }

  private replaysToSchemaRow({ id, schema }: TableVersion): boolean {
    const replayed = this.headLedger.schemas.get(id);

    return replayed !== undefined && schemasEqual(replayed, schema);
  }
}

export function isUnledgered(
  pair: TablePair,
  headSlots: readonly TableSlot[],
  draftSlots: readonly TableSlot[],
): boolean {
  if (!pair.head) {
    return !isLedgered(draftSlots, publicTableIdOf(pair));
  }

  return !isLedgered(headSlots, pair.head.id);
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
