import { HttpException, Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { PlanEstimate } from 'src/features/partial-changes/limits/operation-estimator';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { AttemptObserver } from 'src/infrastructure/database/operation-transaction-runner';

export type DraftRead = 'tableChanges' | 'rowChanges' | 'summary';

export type LedgerOperation = 'backfill' | 'repair';

export type PartialOperation =
  | 'list'
  | 'preview'
  | ChangeOperation
  | DraftRead
  | LedgerOperation;

export const OPERATION_FINISHED = 'Partial changes operation finished';

export const LEDGER_OPERATION_FINISHED = 'Schema ledger operation finished';

const LEDGER_OPERATIONS: ReadonlySet<PartialOperation> =
  new Set<LedgerOperation>(['backfill', 'repair']);

const LOGGED_REFUSED_TABLE_IDS = 5;

// What an operation learned from its plan, or from its listing page; only ids and counts, never row data.
export interface PlannedFacts {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly refusedTables: readonly RefusedTable[];
  // False when a limit stopped the plan; a listing page has no plan.
  readonly planned?: boolean;
  readonly estimate?: PlanEstimate;
}

export interface LoggedEstimate {
  readonly changedRows: number;
  readonly mergedRows: number;
  readonly perRowWorkRows: number;
  readonly mixedTables: number;
  readonly maxLinksCopied: number;
}

export interface OperationLogEntry {
  readonly message: string;
  readonly operation: PartialOperation;
  readonly projectId?: string;
  readonly branchName?: string;
  readonly previousHeadRevisionId?: string;
  readonly headRevisionId?: string;
  readonly draftRevisionId?: string;
  readonly dryRun?: boolean;
  readonly durationMs: number;
  readonly outcome: string;
  readonly attempts: number;
  readonly escalations: number;
  readonly tooLarge?: boolean;
  readonly estimate?: LoggedEstimate;
  readonly refusedTables?: number;
  readonly refusedTableIds?: readonly string[];
  readonly pageSize?: number;
  readonly returned?: number;
  readonly filters?: readonly string[];
  readonly entries?: number;
  readonly tables?: number;
  readonly repairedTables?: number;
  readonly renumbered?: number;
  readonly error?: string;
  readonly errorCode?: string;
}

// What an operation reports beyond its plan: its input, its page or what it wrote; only ids and counts.
export type OperationDetails = Pick<
  OperationLogEntry,
  | 'previousHeadRevisionId'
  | 'headRevisionId'
  | 'draftRevisionId'
  | 'dryRun'
  | 'pageSize'
  | 'returned'
  | 'filters'
  | 'entries'
  | 'tables'
  | 'repairedTables'
  | 'renumbered'
>;

export class OperationTrace implements AttemptObserver {
  private attempts = 0;

  private escalations = 0;

  private facts?: PlannedFacts;

  private details: OperationDetails = {};

  private outcome?: string;

  // Each attempt plans again, so the facts of an earlier one no longer describe the operation.
  public attempted(escalated: boolean): void {
    this.attempts += 1;
    this.facts = undefined;

    if (escalated) {
      this.escalations += 1;
    }
  }

  public planned({
    headRevisionId,
    draftRevisionId,
    refusedTables,
    planned,
    estimate,
  }: PlannedFacts): void {
    this.facts = {
      headRevisionId,
      draftRevisionId,
      refusedTables,
      planned,
      estimate,
    };
  }

  // Details survive a new attempt: they describe the input or the result, not one attempt's plan.
  public described(details: OperationDetails): void {
    this.details = { ...this.details, ...details };
  }

  // For a result without a status.
  public concluded(outcome: string): void {
    this.outcome = outcome;
  }

  public outcomeOf(operation: PartialOperation, result: unknown): string {
    return this.outcome ?? statusOf(result) ?? defaultOutcomeOf(operation);
  }

  public entryOf(
    operation: PartialOperation,
    branch: unknown,
    durationMs: number,
    outcome: string,
  ): OperationLogEntry {
    return {
      message: messageOf(operation),
      operation,
      ...branchFieldsOf(branch),
      ...this.revisionFields(),
      durationMs,
      outcome,
      attempts: this.attempts,
      escalations: this.escalations,
      ...this.planFields(),
      ...this.details,
    };
  }

  private revisionFields(): RevisionFields {
    if (!this.facts) {
      return {};
    }

    const { headRevisionId, draftRevisionId } = this.facts;

    return { headRevisionId, draftRevisionId };
  }

  private planFields(): LimitFields & RefusalFields {
    if (!this.facts) {
      return {};
    }

    return {
      ...limitFieldsOf(this.facts),
      ...refusalFieldsOf(this.facts.refusedTables),
    };
  }
}

type BranchFields = Pick<OperationLogEntry, 'projectId' | 'branchName'>;

type RevisionFields = Pick<
  OperationLogEntry,
  'headRevisionId' | 'draftRevisionId'
>;

type LimitFields = Pick<OperationLogEntry, 'tooLarge' | 'estimate'>;

type RefusalFields = Pick<
  OperationLogEntry,
  'refusedTables' | 'refusedTableIds'
>;

type ErrorFields = Pick<OperationLogEntry, 'error' | 'errorCode'>;

// One entry per listing page, Draft read, preview, commit, revert, backfill or repair, when it ends: info when it
// returns, warn when it throws.
@Injectable()
export class PartialOperationLog {
  private readonly logger = new Logger(PartialOperationLog.name);

  public async track<Result>(
    operation: PartialOperation,
    branch: unknown,
    run: (trace: OperationTrace) => Promise<Result>,
  ): Promise<Result> {
    const trace = new OperationTrace();
    const startedAt = performance.now();
    let result: Result;

    try {
      result = await run(trace);
    } catch (error) {
      this.write(() =>
        this.logger.warn({
          ...trace.entryOf(
            operation,
            branch,
            elapsedMsSince(startedAt),
            'error',
          ),
          ...errorFieldsOf(error),
        }),
      );

      throw error;
    }

    this.write(() =>
      this.logger.log(
        trace.entryOf(
          operation,
          branch,
          elapsedMsSince(startedAt),
          trace.outcomeOf(operation, result),
        ),
      ),
    );

    return result;
  }

  // The host's logger must not turn an applied commit into an error, or replace the operation's own error.
  private write(entry: () => void): void {
    try {
      entry();
    } catch {
      // Logging is best effort.
    }
  }
}

function statusOf(result: unknown): string | undefined {
  const { status } = result as { status?: unknown };

  return typeof status === 'string' ? status : undefined;
}

// A listing page and a Draft read have no status.
function defaultOutcomeOf(operation: PartialOperation): string {
  return operation === 'list' ? 'listed' : 'read';
}

function messageOf(operation: PartialOperation): string {
  return LEDGER_OPERATIONS.has(operation)
    ? LEDGER_OPERATION_FINISHED
    : OPERATION_FINISHED;
}

function elapsedMsSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

// The input is logged as given, before validation, so only its string fields are read.
function branchFieldsOf(branch: unknown): BranchFields {
  if (typeof branch !== 'object' || branch === null) {
    return {};
  }

  const { projectId, branchName } = branch as Record<string, unknown>;
  const fields: { projectId?: string; branchName?: string } = {};

  if (typeof projectId === 'string') {
    fields.projectId = projectId;
  }

  if (typeof branchName === 'string') {
    fields.branchName = branchName;
  }

  return fields;
}

// A listing applies no limit, so it says nothing of one.
function limitFieldsOf({ planned, estimate }: PlannedFacts): LimitFields {
  if (planned === undefined) {
    return {};
  }

  if (planned) {
    return { tooLarge: false };
  }

  if (!estimate) {
    return { tooLarge: true };
  }

  return { tooLarge: true, estimate: loggedEstimateOf(estimate) };
}

function refusalFieldsOf(
  refusedTables: readonly RefusedTable[],
): RefusalFields {
  if (refusedTables.length === 0) {
    return { refusedTables: 0 };
  }

  return {
    refusedTables: refusedTables.length,
    refusedTableIds: refusedTables
      .slice(0, LOGGED_REFUSED_TABLE_IDS)
      .map(({ tableId }) => tableId),
  };
}

function loggedEstimateOf({
  changedRows,
  mergedRows,
  perRowWorkRows,
  mixedTables,
}: PlanEstimate): LoggedEstimate {
  return {
    changedRows,
    mergedRows,
    perRowWorkRows,
    mixedTables: mixedTables.length,
    maxLinksCopied: Math.max(
      0,
      ...mixedTables.map(({ linksCopied }) => linksCopied),
    ),
  };
}

// Names and codes only: an error message can quote selectors or values.
function errorFieldsOf(error: unknown): ErrorFields {
  if (!(error instanceof Error)) {
    return { error: typeof error };
  }

  const code = codeOf(error);

  if (code === undefined) {
    return { error: error.name };
  }

  return { error: error.name, errorCode: code };
}

function codeOf(error: Error): string | undefined {
  const source =
    error instanceof HttpException ? error.getResponse() : (error as unknown);

  if (typeof source !== 'object' || source === null) {
    return undefined;
  }

  const { code } = source as { code?: unknown };

  return typeof code === 'string' ? code : undefined;
}
