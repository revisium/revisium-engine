import type { JsonSchema } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type { Row } from 'src/engine-prisma-types';
import type { ReplayRules } from 'src/features/migration/ledger-repair/repair-ledger';
import {
  type RepairState,
  type RevisionLedger,
  revisionLedgerOf,
} from 'src/features/migration/ledger-repair/repair-state-reader';
import type { SchemaLedgerScanStats } from 'src/features/migration/queries/impl/scan-schema-ledger.query';
import { ledgerOf } from 'src/features/share/ledger/migration-ledger';
import {
  replayLedger,
  type ReplayedSlot,
} from 'src/features/share/ledger-replay/ledger-replay';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import {
  type SchemaCheck,
  schemaCheckOf,
  type SchemaRow,
} from './schema-checks';
import type {
  BranchRevisions,
  RevisionTables,
  RowHashCount,
  ScanRevisionReader,
} from './scan-revision-reader';

const HEAD_AND_DRAFT_REVISIONS = 2;

export interface ScannedTable {
  readonly tableId: string;
  readonly tableVersionId: string;
  readonly schemaRow: SchemaRow;
  readonly check: SchemaCheck;
  readonly schemaEvaluation: string;
}

interface ScannedLedger {
  readonly rows: readonly Row[];
  readonly currentSlots: ReadonlyMap<string, ReplayedSlot>;
}

type ScanCounts = { -readonly [Key in keyof SchemaLedgerScanStats]: number };

type CachedRead = 'ledgerReplays' | 'schemaTableReads' | 'rowHashReads';

export class LedgerScan {
  private readonly ledgers = new Map<string, ScannedLedger>();
  private readonly schemaTables = new Map<string, Row[]>();
  private readonly schemaChecks = new Map<string, SchemaCheck>();
  private readonly rowHashes = new Map<string, RowHashCount[]>();
  private readonly schemaHashes = new WeakMap<JsonSchema, string>();
  private readonly counts: ScanCounts = {
    branches: 0,
    revisions: 0,
    ledgerReplays: 0,
    schemaTableReads: 0,
    schemaChecks: 0,
    rowHashReads: 0,
  };

  constructor(
    private readonly reader: ScanRevisionReader,
    private readonly rules: ReplayRules,
  ) {}

  public get stats(): SchemaLedgerScanStats {
    return { ...this.counts };
  }

  public countBranch({ historyRevisionIds }: BranchRevisions): void {
    this.counts.branches += 1;
    this.counts.revisions +=
      HEAD_AND_DRAFT_REVISIONS + historyRevisionIds.length;
  }

  public async tablesOf(revision: RevisionTables): Promise<ScannedTable[]> {
    if (revision.tableVersionIds.size === 0) {
      return [];
    }

    const schemaRows = schemaRowsOf(await this.schemaTableRowsOf(revision));
    const ledgerVersionId = revision.migrationTableVersionId ?? '';
    const ledger = await this.scannedLedgerOf(revision);
    const tables: ScannedTable[] = [];

    for (const [tableId, tableVersionId] of sortedByKey(
      revision.tableVersionIds,
    )) {
      const schemaRow = schemaRows.get(tableId);

      if (schemaRow) {
        const schemaEvaluation = `${ledgerVersionId}/${schemaRow.versionId}`;

        tables.push({
          tableId,
          tableVersionId,
          schemaRow,
          check: this.checkSchema(schemaEvaluation, ledger, schemaRow),
          schemaEvaluation,
        });
      }
    }

    return tables;
  }

  public async rowHashesOf(tableVersionId: string): Promise<RowHashCount[]> {
    return this.cached(this.rowHashes, tableVersionId, 'rowHashReads', () =>
      this.reader.readRowHashes(tableVersionId),
    );
  }

  public hashOf(schema: JsonSchema): string {
    let hash = this.schemaHashes.get(schema);

    if (hash === undefined) {
      hash = objectHash(schema);
      this.schemaHashes.set(schema, hash);
    }

    return hash;
  }

  public async repairStateOf(
    { headRevisionId, draftRevisionId }: BranchRevisions,
    head: RevisionTables,
    draft: RevisionTables,
  ): Promise<RepairState> {
    return {
      headRevisionId,
      draftRevisionId,
      head: await this.revisionLedgerOf(head),
      draft: await this.revisionLedgerOf(draft),
    };
  }

  private async revisionLedgerOf(
    revision: RevisionTables,
  ): Promise<RevisionLedger> {
    const ledger = await this.scannedLedgerOf(revision);

    return revisionLedgerOf(
      revision.tableVersionIds,
      await this.schemaTableRowsOf(revision),
      ledger?.rows ?? [],
    );
  }

  private checkSchema(
    schemaEvaluation: string,
    ledger: ScannedLedger | undefined,
    schemaRow: SchemaRow,
  ): SchemaCheck {
    let check = this.schemaChecks.get(schemaEvaluation);

    if (!check) {
      check = schemaCheckOf(ledger?.currentSlots, schemaRow);
      this.schemaChecks.set(schemaEvaluation, check);
      this.counts.schemaChecks += 1;
    }

    return check;
  }

  private async schemaTableRowsOf({
    schemaTableVersionId,
  }: RevisionTables): Promise<Row[]> {
    if (schemaTableVersionId === undefined) {
      return [];
    }

    return this.cached(
      this.schemaTables,
      schemaTableVersionId,
      'schemaTableReads',
      () => this.reader.readTableRows(schemaTableVersionId),
    );
  }

  private async scannedLedgerOf({
    migrationTableVersionId,
  }: RevisionTables): Promise<ScannedLedger | undefined> {
    if (migrationTableVersionId === undefined) {
      return undefined;
    }

    return this.cached(
      this.ledgers,
      migrationTableVersionId,
      'ledgerReplays',
      async () =>
        this.replayed(await this.reader.readTableRows(migrationTableVersionId)),
    );
  }

  private replayed(rows: Row[]): ScannedLedger {
    const replay = replayLedger({
      ledger: ledgerOf(rows).map(({ migration }) => migration),
      ...this.rules,
    });
    const currentSlots = new Map<string, ReplayedSlot>();

    for (const slot of replay.slots) {
      if (slot.currentTableId !== undefined) {
        currentSlots.set(slot.currentTableId, slot);
      }
    }

    return { rows, currentSlots };
  }

  private async cached<T>(
    cache: Map<string, T>,
    key: string,
    countedAs: CachedRead,
    read: () => Promise<T>,
  ): Promise<T> {
    const cachedValue = cache.get(key);

    if (cachedValue !== undefined) {
      return cachedValue;
    }

    const value = await read();
    cache.set(key, value);
    this.counts[countedAs] += 1;

    return value;
  }
}

function schemaRowsOf(rows: readonly Row[]): Map<string, SchemaRow> {
  return new Map(
    rows.map((row) => [
      row.id,
      {
        tableId: row.id,
        versionId: row.versionId,
        hash: row.hash,
        schema: row.data as unknown as JsonSchema,
      },
    ]),
  );
}

function sortedByKey(entries: ReadonlyMap<string, string>): [string, string][] {
  return [...entries].sort(([left], [right]) => compareCodePoints(left, right));
}
