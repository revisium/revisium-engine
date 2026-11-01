import type { RepairOutcome } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import type {
  DamageShape,
  FindingContent,
  FindingRole,
  SchemaLedgerFinding,
} from 'src/features/migration/queries/impl/scan-schema-ledger.query';
import type { ScannedBranch } from './branch-page-reader';
import type { LedgerScan, ScannedTable } from './ledger-scan';
import { damageShapeOf, type ReplayedCheck } from './schema-checks';
import type { RevisionTables } from './scan-revision-reader';

export type HeadRepairs = ReadonlyMap<string, RepairOutcome> | 'deferred';

const HISTORY_DAMAGE: FindingContent = { code: 'damagedHistory', detail: {} };

type DamageFinding = (
  table: ScannedTable,
  check: ReplayedCheck,
) => FindingContent | undefined | Promise<FindingContent | undefined>;

interface CollectedFinding {
  readonly finding: SchemaLedgerFinding;
  readonly revisionIds: string[];
}

export class BranchScan {
  private readonly findings = new Map<string, CollectedFinding>();
  private readonly damagedHeadLineages = new Set<string>();

  constructor(
    private readonly branch: ScannedBranch,
    private readonly scan: LedgerScan,
  ) {}

  public all(): SchemaLedgerFinding[] {
    return [...this.findings.values()].map(({ finding, revisionIds }) => ({
      ...finding,
      revisionIds,
    }));
  }

  public async addHeadAndDraft(
    head: RevisionTables,
    draft: RevisionTables,
    repairs: HeadRepairs,
  ): Promise<void> {
    await this.addRevision(head, 'head', (table, check) =>
      this.headDamageOf(table, check, repairs),
    );
    await this.addRevision(draft, 'draft', (_table, check) =>
      this.draftDamageOf(check),
    );
  }

  public addHistory(revision: RevisionTables): Promise<void> {
    return this.addRevision(revision, 'history', () => HISTORY_DAMAGE);
  }

  private async addRevision(
    revision: RevisionTables,
    role: FindingRole,
    damageFindingOf: DamageFinding,
  ): Promise<void> {
    for (const table of await this.scan.tablesOf(revision)) {
      const content = await this.findingOf(table, damageFindingOf);

      if (content) {
        this.add(revision.revisionId, role, table, content);
      }
    }
  }

  private async findingOf(
    table: ScannedTable,
    damageFindingOf: DamageFinding,
  ): Promise<FindingContent | undefined> {
    const { check } = table;

    if (check.kind === 'unledgered') {
      return { code: 'unledgeredTable', detail: check.detail };
    }

    if (check.kind === 'unreplayable') {
      return { code: 'unreplayableLedger', detail: check.failure };
    }

    if (check.passes) {
      return undefined;
    }

    return damageFindingOf(table, check);
  }

  private async headDamageOf(
    table: ScannedTable,
    check: ReplayedCheck,
    repairs: HeadRepairs,
  ): Promise<FindingContent> {
    this.damagedHeadLineages.add(lineageOf(check));

    return {
      code: 'damagedTable',
      detail: {
        shape: await this.shapeOf(table, check),
        repair: repairOf(repairs, table.tableId),
      },
    };
  }

  private draftDamageOf(check: ReplayedCheck): FindingContent | undefined {
    if (this.damagedHeadLineages.has(lineageOf(check))) {
      return undefined;
    }

    return { code: 'draftOnlyDamage', detail: {} };
  }

  private async shapeOf(
    table: ScannedTable,
    { slot }: ReplayedCheck,
  ): Promise<DamageShape> {
    const replayedHash = slot.schema
      ? this.scan.hashOf(slot.schema)
      : undefined;

    return damageShapeOf(
      await this.scan.rowHashesOf(table.tableVersionId),
      table.schemaRow.hash,
      replayedHash,
    );
  }

  private add(
    revisionId: string,
    role: FindingRole,
    { tableId, schemaEvaluation }: ScannedTable,
    content: FindingContent,
  ): void {
    const key = [role, content.code, tableId, schemaEvaluation].join('\n');
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

function lineageOf({ slot }: ReplayedCheck): string {
  return slot.migrations[0]?.id ?? '';
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
