import { performance } from 'node:perf_hooks';

export function blockEventLoopFor(durationMs: number): void {
  const until = performance.now() + durationMs;

  while (performance.now() < until) {
    continue;
  }
}
