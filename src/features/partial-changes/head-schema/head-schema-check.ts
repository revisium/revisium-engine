import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { publicTableIdOf } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { LedgerAttribution } from 'src/features/partial-changes/catalogue/ledger-attribution';
import { compareCodePoints } from 'src/features/partial-changes/catalogue/unit-order';
import type {
  ChangesSnapshot,
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  type LedgerReplayInput,
  replayLedger,
  type ReplayedLedger,
} from 'src/features/share/ledger-replay/ledger-replay';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import { isLedgered } from 'src/features/share/ledger-replay/table-slots';

export type RefusalCode = 'headSchemaInconsistent' | 'unledgeredTable';

export interface RefusedTable {
  readonly tableId: string;
  readonly code: RefusalCode;
}

export type LedgerReplayRules = Pick<LedgerReplayInput, 'refs' | 'validator'>;

export interface HeadSchemaCheckInput {
  readonly snapshot: ChangesSnapshot;
  readonly ledger: LedgerAttribution;
  readonly wholeDraft: boolean;
}

export interface HeadSchemaCheck {
  readonly refusedTables: readonly RefusedTable[];
  readonly refusedIdentities: ReadonlySet<string>;
  readonly replayedHeadSchemas: ReadonlyMap<string, JsonSchema>;
}

interface Refusal {
  readonly identity: string;
  readonly table: RefusedTable;
}

export function checkHeadSchema(
  input: HeadSchemaCheckInput,
  rules: LedgerReplayRules,
): HeadSchemaCheck {
  const headLedger = replayLedger({
    ledger: input.ledger.published.map(({ migration }) => migration),
    ...rules,
  });
  const refusals = refusalsOf(input, headLedger);

  return {
    refusedTables: refusals.map(({ table }) => table),
    refusedIdentities: new Set(refusals.map(({ identity }) => identity)),
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

  return new TableRefusals(headLedger, input.ledger)
    .of(input.snapshot.tables)
    .sort(byTableIdAndCode);
}

class TableRefusals {
  constructor(
    private readonly headLedger: ReplayedLedger,
    private readonly ledger: LedgerAttribution,
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
    if (!pair.head) {
      return this.createdTableCodeOf(pair);
    }

    return this.headTableCodeOf(pair.head);
  }

  private headTableCodeOf(head: TableVersion): RefusalCode | undefined {
    if (!isLedgered(this.headLedger.slots, head.id)) {
      return 'unledgeredTable';
    }

    if (!this.replaysToSchemaRow(head)) {
      return 'headSchemaInconsistent';
    }

    return undefined;
  }

  private createdTableCodeOf({ identity }: TablePair): RefusalCode | undefined {
    if (this.hasPendingLineage(identity)) {
      return undefined;
    }

    return 'unledgeredTable';
  }

  private replaysToSchemaRow({ id, schema }: TableVersion): boolean {
    const replayed = this.headLedger.schemas.get(id);

    return replayed !== undefined && schemasEqual(replayed, schema);
  }

  private hasPendingLineage(tableIdentity: string): boolean {
    return this.ledger.tables.has(tableIdentity);
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
