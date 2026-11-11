import { HttpException, Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import type { AttemptObserver } from 'src/infrastructure/database/operation-transaction-runner';

// Fields an operation adds to its entry; only ids, counts and names, never row data, values or messages.
export type LogFields = Readonly<Record<string, unknown>>;

// What a caller logs an operation as.
export interface TrackedOperation {
  readonly operation: string;
  readonly message: string;
  // The input as given, before validation: only its string `projectId` and `branchName` are read.
  readonly branch: unknown;
  // The outcome of a result that has no `status` and was not concluded.
  readonly outcome?: string;
}

export interface OperationLogEntry {
  readonly message: string;
  readonly operation: string;
  readonly projectId?: string;
  readonly branchName?: string;
  readonly durationMs: number;
  readonly outcome: string;
  readonly attempts: number;
  readonly escalations: number;
  readonly error?: string;
  readonly errorCode?: string;
  readonly [field: string]: unknown;
}

const DEFAULT_OUTCOME = 'finished';

export class OperationTrace implements AttemptObserver {
  private attempts = 0;

  private escalations = 0;

  private attemptFields?: LogFields;

  private details: LogFields = {};

  private outcome?: string;

  // Each attempt plans again, so what an earlier one planned no longer describes the operation.
  public attempted(escalated: boolean): void {
    this.attempts += 1;
    this.attemptFields = undefined;

    if (escalated) {
      this.escalations += 1;
    }
  }

  // What the current attempt planned; replaced by the next plan, dropped by the next attempt.
  public planned(fields: LogFields): void {
    this.attemptFields = fields;
  }

  // Details survive a new attempt: they describe the input or the result, not one attempt's plan.
  public described(details: LogFields): void {
    this.details = { ...this.details, ...details };
  }

  // For a result without a status.
  public concluded(outcome: string): void {
    this.outcome = outcome;
  }

  public outcomeOf(tracked: TrackedOperation, result: unknown): string {
    return (
      this.outcome ?? statusOf(result) ?? tracked.outcome ?? DEFAULT_OUTCOME
    );
  }

  public entryOf(
    { operation, message, branch }: TrackedOperation,
    durationMs: number,
    outcome: string,
  ): OperationLogEntry {
    return {
      message,
      operation,
      ...branchFieldsOf(branch),
      durationMs,
      outcome,
      attempts: this.attempts,
      escalations: this.escalations,
      ...this.attemptFields,
      ...this.details,
    };
  }
}

type BranchFields = Pick<OperationLogEntry, 'projectId' | 'branchName'>;

type ErrorFields = Pick<OperationLogEntry, 'error' | 'errorCode'>;

// One entry per tracked operation, when it ends: info when it returns, warn when it throws.
@Injectable()
export class OperationLog {
  private readonly logger = new Logger(OperationLog.name);

  public async track<Result>(
    tracked: TrackedOperation,
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
          ...trace.entryOf(tracked, elapsedMsSince(startedAt), 'error'),
          ...errorFieldsOf(error),
        }),
      );

      throw error;
    }

    this.write(() =>
      this.logger.log(
        trace.entryOf(
          tracked,
          elapsedMsSince(startedAt),
          trace.outcomeOf(tracked, result),
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
  if (typeof result !== 'object' || result === null) {
    return undefined;
  }

  const { status } = result as { status?: unknown };

  return typeof status === 'string' ? status : undefined;
}

function elapsedMsSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

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
