import { LeaseHeartbeat } from 'src/features/migration/services/lease-heartbeat';

const INTERVAL_MS = 1_000;

describe('LeaseHeartbeat', () => {
  it('renews the lease on every interval until it is stopped', async () => {
    const renew = jest.fn().mockResolvedValue(true);
    const heartbeat = new LeaseHeartbeat(renew, INTERVAL_MS, jest.fn());

    await jest.advanceTimersByTimeAsync(3 * INTERVAL_MS);
    heartbeat.stop();
    await jest.advanceTimersByTimeAsync(3 * INTERVAL_MS);

    expect(renew).toHaveBeenCalledTimes(3);
  });

  it('stops renewing once a renewal finds the lease taken by another owner', async () => {
    const renew = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const heartbeat = new LeaseHeartbeat(renew, INTERVAL_MS, jest.fn());

    await jest.advanceTimersByTimeAsync(5 * INTERVAL_MS);
    heartbeat.stop();

    expect(renew).toHaveBeenCalledTimes(2);
  });

  it('reports a failed renewal and keeps renewing', async () => {
    const failure = new Error('connection lost');
    const renew = jest
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(true);
    const onError = jest.fn();
    const heartbeat = new LeaseHeartbeat(renew, INTERVAL_MS, onError);

    await jest.advanceTimersByTimeAsync(2 * INTERVAL_MS);
    heartbeat.stop();

    expect(onError).toHaveBeenCalledWith(failure);
    expect(renew).toHaveBeenCalledTimes(2);
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });
});
