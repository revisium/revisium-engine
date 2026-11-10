import { HttpException, Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { PlanEstimate } from 'src/features/partial-changes/limits/operation-estimator';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { AttemptObserver } from 'src/infrastructure/database/operation-transaction-runner';

export type PartialOperation = 'list' | 'preview' | ChangeOperation;

export const OPERATION_FINISHED = 'Partial changes operation finished';

const LOGGED_REFUSED_TABLE_IDS = 5;

// What an operation learned from its plan, or from its listing page; only ids and counts, never row data.
export interface PlannedFacts {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly refusedTables: readonly RefusedTable[];
  readonly refusedByLimit?: boolean;
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
  readonly headRevisionId?: string;
  readonly draftRevisionId?: string;
  readonly durationMs: number;
  readonly outcome: string;
  readonly attempts: number;
  readonly escalations: number;
  readonly tooLarge?: boolean;
  readonly estimate?: LoggedEstimate;
  readonly refusedTables?: number;
  readonly refusedTableIds?: readonly string[];
  readonly error?: string;
  readonly errorCode?: string;
}

export class OperationTrace implements AttemptObserver {
  private attempts = 0;

  private escalations = 0;

  private facts?: PlannedFacts;

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
    refusedByLimit,
    estimate,
  }: PlannedFacts): void {
    this.facts = {
      headRevisionId,
      draftRevisionId,
      refusedTables,
      refusedByLimit,
      estimate,
    };
  }

  public entryOf(
    operation: PartialOperation,
    branch: unknown,
    durationMs: number,
    outcome: string,
  ): OperationLogEntry {
    return {
      message: OPERATION_FINISHED,
      operation,
      ...branchFieldsOf(branch),
      ...this.revisionFields(),
      durationMs,
      outcome,
      attempts: this.attempts,
      escalations: this.escalations,
      ...this.planFields(),
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

// One entry per listing page, preview, commit or revert, when it ends: info when it returns, warn when it throws.
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
          outcomeOf(result),
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

// A listing page has no status.
function outcomeOf(result: unknown): string {
  const { status } = result as { status?: unknown };

  return typeof status === 'string' ? status : 'listed';
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
function limitFieldsOf({
  refusedByLimit,
  estimate,
}: PlannedFacts): LimitFields {
  if (refusedByLimit === undefined) {
    return {};
  }

  if (!refusedByLimit || !estimate) {
    return { tooLarge: refusedByLimit };
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
