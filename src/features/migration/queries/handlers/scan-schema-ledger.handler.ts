import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { LedgerRepairPlanService } from 'src/features/migration/ledger-repair/ledger-repair-plan.service';
import {
  BranchPageReader,
  type ScannedBranch,
} from 'src/features/migration/ledger-scan/branch-page-reader';
import {
  BranchScan,
  type HeadRepairs,
} from 'src/features/migration/ledger-scan/branch-scan';
import {
  LedgerScan,
  type ScannedTable,
} from 'src/features/migration/ledger-scan/ledger-scan';
import { scanRequestOf } from 'src/features/migration/ledger-scan/scan-request';
import {
  type ScannedBranchRevisions,
  type ScannedRevision,
  ScanRevisionReader,
} from 'src/features/migration/ledger-scan/scan-revision-reader';
import {
  type RowDiagnostics,
  type SchemaLedgerFinding,
  type SchemaLedgerScan,
  ScanSchemaLedgerQuery,
} from 'src/features/migration/queries/impl/scan-schema-ledger.query';
import { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';

@QueryHandler(ScanSchemaLedgerQuery)
export class ScanSchemaLedgerHandler implements IQueryHandler<
  ScanSchemaLedgerQuery,
  SchemaLedgerScan
> {
  constructor(
    private readonly transactionRunner: OperationTransactionRunner,
    private readonly branchPages: BranchPageReader,
    private readonly reader: ScanRevisionReader,
    private readonly repairPlanService: LedgerRepairPlanService,
    private readonly replayer: LedgerReplayer,
  ) {}

  public async execute({
    data,
  }: ScanSchemaLedgerQuery): Promise<SchemaLedgerScan> {
    const request = scanRequestOf(data);
    const page = await this.branchPages.readPage(request);
    const scan = new LedgerScan(
      this.reader,
      this.replayer,
      request.rowDiagnostics !== 'none',
    );
    const findings: SchemaLedgerFinding[] = [];

    for (const branch of page.branches) {
      findings.push(
        ...(await this.scanBranch(branch, scan, request.rowDiagnostics)),
      );
    }

    return { findings, nextCursor: page.nextCursor, stats: scan.stats };
  }

  private async scanBranch(
    branch: ScannedBranch,
    scan: LedgerScan,
    rowDiagnostics: RowDiagnostics,
  ): Promise<SchemaLedgerFinding[]> {
    const branchScan = new BranchScan(branch, scan, rowDiagnostics);
    const historyRevisionIds = await this.transactionRunner.runPlanning(() =>
      this.scanHeadAndDraft(branch, scan, branchScan),
    );

    for (const revision of await this.reader.readRevisions(
      historyRevisionIds,
    )) {
      await branchScan.addHistory(revision);
    }

    return branchScan.all();
  }

  private async scanHeadAndDraft(
    branch: ScannedBranch,
    scan: LedgerScan,
    branchScan: BranchScan,
  ): Promise<readonly string[]> {
    const revisions = await this.reader.readBranchRevisions(branch);
    scan.countBranch(revisions);
    const head = await this.reader.readRevision(revisions.headRevisionId);
    const draft = await this.reader.readRevision(revisions.draftRevisionId);

    await branchScan.addHeadAndDraft(
      head,
      draft,
      await this.headRepairsOf(scan, revisions, head, draft),
    );

    return revisions.historyRevisionIds;
  }

  private async headRepairsOf(
    scan: LedgerScan,
    revisions: ScannedBranchRevisions,
    head: ScannedRevision,
    draft: ScannedRevision,
  ): Promise<HeadRepairs> {
    if (!hasDamagedTable(await scan.tablesOf(head))) {
      return new Map();
    }

    if (await this.reader.hasActiveMigration(revisions.draftRevisionId)) {
      return 'deferred';
    }

    const { state, storedReplays } = await scan.repairInputOf(
      revisions,
      head,
      draft,
    );
    const plan = await this.repairPlanService.plan(state, { storedReplays });

    return new Map(
      plan.tables.map(({ tableId, outcome }) => [tableId, outcome]),
    );
  }
}

function hasDamagedTable(tables: readonly ScannedTable[]): boolean {
  return tables.some(({ check }) => check.kind === 'replayed' && !check.passes);
}
