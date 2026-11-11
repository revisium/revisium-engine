import { Logger } from '@nestjs/common';
import {
  OperationLog,
  type OperationLogEntry,
  type OperationTrace,
  type TrackedOperation,
} from 'src/infrastructure/database/operation-log';
import { OperationTimeoutException } from 'src/infrastructure/database/operation-timeout.exception';

const OPERATION_FINISHED = 'Operation finished';
const SECRET_TITLE = 'a secret title';
const BRANCH = { projectId: 'project', branchName: 'master' };

describe('OperationLog', () => {
  describe('an entry', () => {
    it('takes its outcome from the conclusion, else the status, else the default of the operation', async () => {
      const entries = loggedEntries();
      const log = new OperationLog();
      const tracked = { ...trackedAs('read', BRANCH), outcome: 'read' };

      await log.track(tracked, (trace) => {
        trace.concluded(() => 'repaired');

        return Promise.resolve({ status: 'applied' });
      });
      await log.track(tracked, () => Promise.resolve({ status: 'applied' }));
      await log.track(tracked, () => Promise.resolve(undefined));
      await log.track(trackedAs('write', BRANCH), () => Promise.resolve(null));

      expect(entries.finished().map(({ outcome }) => outcome)).toEqual([
        'repaired',
        'applied',
        'read',
        'finished',
      ]);
    });

    it('drops what an attempt planned when the next one starts, and keeps the details', async () => {
      const entries = loggedEntries();

      await new OperationLog().track(trackedAs('write', BRANCH), (trace) => {
        trace.described(() => ({ dryRun: false }));
        trace.attempted(false);
        trace.planned(() => ({ headRevisionId: 'head' }));
        trace.attempted(true);
        trace.described(() => ({ entries: 2 }));

        return Promise.resolve({ status: 'written' });
      });

      const [entry] = entries.finished();
      expect(entry).toMatchObject({
        attempts: 2,
        escalations: 1,
        dryRun: false,
        entries: 2,
      });
      expect(entry).not.toHaveProperty('headRevisionId');
    });
  });

  describe('a describer that throws', () => {
    it('changes neither the result nor the error, since every field is computed under the best-effort boundary', async () => {
      const log = new OperationLog();
      const timeout = new OperationTimeoutException(5);
      const throwingDescribers = (trace: OperationTrace) => {
        trace.planned(() => {
          throw new RangeError('planned');
        });
        trace.described(() => {
          throw new RangeError('described');
        });
        trace.concluded(() => {
          throw new RangeError('concluded');
        });
      };

      await expect(
        log.track(trackedAs('write', BRANCH), (trace) => {
          throwingDescribers(trace);

          return Promise.resolve({ status: 'applied' });
        }),
      ).resolves.toEqual({ status: 'applied' });
      await expect(
        log.track(trackedAs('write', BRANCH), (trace) => {
          throwingDescribers(trace);

          return Promise.reject(timeout);
        }),
      ).rejects.toBe(timeout);
    });
  });

  describe('a failure', () => {
    it('is logged as a warning with its name and code, and rethrown', async () => {
      const entries = loggedEntries();
      const timeout = new OperationTimeoutException(5);

      await expect(
        new OperationLog().track(trackedAs('commit', BRANCH), (trace) => {
          trace.attempted(false);

          return Promise.reject(timeout);
        }),
      ).rejects.toBe(timeout);

      expect(entries.finished()).toEqual([]);
      expect(entries.failed()).toEqual<OperationLogEntry[]>([
        {
          message: OPERATION_FINISHED,
          operation: 'commit',
          projectId: BRANCH.projectId,
          branchName: BRANCH.branchName,
          durationMs: expect.any(Number) as number,
          outcome: 'error',
          attempts: 1,
          escalations: 0,
          error: 'OperationTimeoutException',
          errorCode: 'OPERATION_TIMEOUT',
        },
      ]);
    });

    it('names a database error by its code, never by its message', async () => {
      const entries = loggedEntries();
      const conflict = Object.assign(new Error(`row ${SECRET_TITLE}`), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2034',
      });

      await expect(
        new OperationLog().track(trackedAs('revert', BRANCH), () =>
          Promise.reject(conflict),
        ),
      ).rejects.toBe(conflict);

      const [entry] = entries.failed();
      expect(entry).toMatchObject({
        error: 'PrismaClientKnownRequestError',
        errorCode: 'P2034',
      });
      expect(JSON.stringify(entry)).not.toContain(SECRET_TITLE);
    });

    it('names an error without a code by its name only', async () => {
      const entries = loggedEntries();
      const failure = new TypeError(`row ${SECRET_TITLE}`);

      await expect(
        new OperationLog().track(trackedAs('commit', BRANCH), () =>
          Promise.reject(failure),
        ),
      ).rejects.toBe(failure);

      const [entry] = entries.failed();
      expect(entry).toMatchObject({ error: 'TypeError' });
      expect(entry).not.toHaveProperty('errorCode');
      expect(JSON.stringify(entry)).not.toContain(SECRET_TITLE);
    });

    it('names a thrown value that is not an Error by its type', async () => {
      const entries = loggedEntries();

      await expect(
        new OperationLog().track(trackedAs('list', BRANCH), () =>
          Promise.reject(SECRET_TITLE),
        ),
      ).rejects.toBe(SECRET_TITLE);

      const [entry] = entries.failed();
      expect(entry).toMatchObject({ error: 'string' });
      expect(JSON.stringify(entry)).not.toContain(SECRET_TITLE);
    });

    it('does not reach the caller when the logger throws after the operation returned', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {
        throw new Error('logger down');
      });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      await expect(
        new OperationLog().track(trackedAs('commit', BRANCH), () =>
          Promise.resolve({ status: 'applied' }),
        ),
      ).resolves.toEqual({ status: 'applied' });

      expect(warn).not.toHaveBeenCalled();
    });

    it('rethrows the error of the operation when the logger throws', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {
        throw new Error('logger down');
      });
      const timeout = new OperationTimeoutException(5);

      await expect(
        new OperationLog().track(trackedAs('commit', BRANCH), () =>
          Promise.reject(timeout),
        ),
      ).rejects.toBe(timeout);
    });

    it('reads no branch from input that is not one', async () => {
      const entries = loggedEntries();

      await expect(
        new OperationLog().track(trackedAs('preview', 'main'), () =>
          Promise.reject(new Error('invalid')),
        ),
      ).rejects.toThrow('invalid');

      const [entry] = entries.failed();
      expect(entry).not.toHaveProperty('projectId');
      expect(entry).not.toHaveProperty('branchName');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});

function trackedAs(operation: string, branch: unknown): TrackedOperation {
  return { operation, message: OPERATION_FINISHED, branch };
}

function loggedEntries() {
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

  return {
    finished: () => operationEntriesOf(log.mock.calls),
    failed: () => operationEntriesOf(warn.mock.calls),
  };
}

function operationEntriesOf(calls: unknown[][]): OperationLogEntry[] {
  return calls
    .map(([entry]) => entry)
    .filter(
      (entry): entry is OperationLogEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { message?: unknown }).message === OPERATION_FINISHED,
    );
}
