import type { RepairOutcome } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import type {
  DamageShape,
  FindingContent,
  FindingRole,
  RowDiagnostics,
  SchemaLedgerFinding,
} from 'src/features/migration/queries/impl/scan-schema-ledger.query';
import type { ScannedBranch } from './branch-page-reader';
import {
  evaluationKeyOf,
  type LedgerScan,
  type ScannedTable,
} from './ledger-scan';
import {
  damageShapeOf,
  lineageOf,
  passesSchemaCheck,
  type ReplayedCheck,
} from './schema-checks';
import type { ScannedRevision } from './scan-revision-reader';

export type HeadRepairs = ReadonlyMap<string, RepairOutcome> | 'deferred';

const HISTORY_DAMAGE: FindingContent = { code: 'damagedHistory', detail: {} };

const DRAFT_ONLY_DAMAGE: FindingContent = {
  code: 'draftOnlyDamage',
  detail: {},
};

type DamageFinding = (
  table: ScannedTable,
  check: ReplayedCheck,
) => FindingContent | undefined | Promise<FindingContent | undefined>;

interface EvaluatedFinding {
  readonly evaluation: string;
  readonly content: FindingContent;
}

interface CollectedFinding {
  readonly finding: SchemaLedgerFinding;
  readonly revisionIds: string[];
}

export class BranchScan {
  private readonly findings = new Map<string, CollectedFinding>();

  constructor(
    private readonly branch: ScannedBranch,
    private readonly scan: LedgerScan,
    private readonly rowDiagnostics: RowDiagnostics,
  ) {}

  public all(): SchemaLedgerFinding[] {
    return [...this.findings.values()].map(({ finding, revisionIds }) => ({
      ...finding,
      revisionIds,
    }));
  }

  public async addHeadAndDraft(
    head: ScannedRevision,
    draft: ScannedRevision,
    repairs: HeadRepairs,
  ): Promise<void> {
    const headTables = await this.scan.tablesOf(head);

    await this.addRevision(head, 'head', (table, check) =>
      this.headDamageOf(table, check, repairs),
    );
    await this.addRevision(draft, 'draft', (table, check) =>
      draftDamageOf(headTables, table, check),
    );
  }

  public addHistory(revision: ScannedRevision): Promise<void> {
    return this.addRevision(revision, 'history', () => HISTORY_DAMAGE);
  }

  private async addRevision(
    revision: ScannedRevision,
    role: FindingRole,
    damageFindingOf: DamageFinding,
  ): Promise<void> {
    for (const table of await this.scan.tablesOf(revision)) {
      for (const evaluated of await this.findingsOf(
        table,
        role,
        damageFindingOf,
      )) {
        this.add(revision.revisionId, role, table.tableId, evaluated);
      }
    }
  }

  private async findingsOf(
    table: ScannedTable,
    role: FindingRole,
    damageFindingOf: DamageFinding,
  ): Promise<EvaluatedFinding[]> {
    const { check, schemaEvaluation } = table;

    if (check.kind === 'unledgered') {
      return evaluatedAs(schemaEvaluation, {
        code: 'unledgeredTable',
        detail: check.detail,
      });
    }

    if (check.kind === 'unreplayable') {
      return evaluatedAs(schemaEvaluation, {
        code: 'unreplayableLedger',
        detail: check.failure,
      });
    }

    const findings: EvaluatedFinding[] = [];

    if (!check.passes) {
      findings.push(
        ...evaluatedAs(schemaEvaluation, await damageFindingOf(table, check)),
      );
    }

    if (this.checksRowsOf(role)) {
      findings.push(
        ...evaluatedAs(
          evaluationKeyOf(schemaEvaluation, table.tableVersionId),
          await this.rowHashMismatchOf(table, check),
        ),
      );
    }

    return findings;
  }

  private async headDamageOf(
    table: ScannedTable,
    check: ReplayedCheck,
    repairs: HeadRepairs,
  ): Promise<FindingContent> {
    return {
      code: 'damagedTable',
      detail: {
        shape: await this.shapeOf(table, check),
        repair: repairOf(repairs, table.tableId),
      },
    };
  }

  private async shapeOf(
    table: ScannedTable,
    { slot }: ReplayedCheck,
  ): Promise<DamageShape> {
    if (!table.schemaRow) {
      return 'unknown';
    }

    const replayedHash = slot.schema
      ? this.scan.hashOf(slot.schema)
      : undefined;

    return damageShapeOf(
      await this.scan.rowHashesOf(table.tableVersionId),
      table.schemaRow.hash,
      replayedHash,
    );
  }

  private async rowHashMismatchOf(
    table: ScannedTable,
    check: ReplayedCheck,
  ): Promise<FindingContent | undefined> {
    const { schemaRow } = table;

    if (!schemaRow) {
      return undefined;
    }

    const rowHashes = await this.scan.classifiedRowHashesOf(
      table,
      check,
      schemaRow.hash,
    );

    if (rowHashes.length === 0) {
      return undefined;
    }

    return {
      code: 'rowSchemaHashMismatch',
      detail: { schemaHash: schemaRow.hash, rowHashes },
    };
  }

  private checksRowsOf(role: FindingRole): boolean {
    if (this.rowDiagnostics === 'all') {
      return true;
    }

    return this.rowDiagnostics === 'headAndDraft' && role !== 'history';
  }

  private add(
    revisionId: string,
    role: FindingRole,
    tableId: string,
    { evaluation, content }: EvaluatedFinding,
  ): void {
    const key = evaluationKeyOf(role, content.code, tableId, evaluation);
    const collected = this.findings.get(key);

    if (collected) {
      collected.revisionIds.push(revisionId);
      return;
    }

    this.findings.set(key, {
      finding: {
        ...content,
        projectId: this.branch.projectId,
        branchName: this.branch.branchName,
        tableId,
        role,
        revisionIds: [],
      },
      revisionIds: [revisionId],
    });
  }
}

function evaluatedAs(
  evaluation: string,
  content: FindingContent | undefined,
): EvaluatedFinding[] {
  if (!content) {
    return [];
  }

  return [{ evaluation, content }];
}

function draftDamageOf(
  headTables: readonly ScannedTable[],
  table: ScannedTable,
  check: ReplayedCheck,
): FindingContent | undefined {
  const headTable = headCounterpartOf(headTables, table.tableId, check.lineage);

  if (headTable && !passesSchemaCheck(headTable.check)) {
    return undefined;
  }

  return DRAFT_ONLY_DAMAGE;
}

function headCounterpartOf(
  headTables: readonly ScannedTable[],
  tableId: string,
  lineage: string,
): ScannedTable | undefined {
  const sameLineage = headTables.find(
    (headTable) => lineageOf(headTable.check) === lineage,
  );

  if (sameLineage) {
    return sameLineage;
  }

  return headTables.find(
    (headTable) =>
      headTable.tableId === tableId && lineageOf(headTable.check) === undefined,
  );
}

function repairOf(
  repairs: HeadRepairs,
  tableId: string,
): RepairOutcome | 'deferred' {
  if (repairs === 'deferred') {
    return 'deferred';
  }

  const outcome = repairs.get(tableId);

  if (outcome === undefined) {
    throw new Error(`The repair plan has no outcome for "${tableId}"`);
  }

  return outcome;
}
