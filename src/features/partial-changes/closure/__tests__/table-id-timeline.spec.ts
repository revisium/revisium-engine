import { obj, str } from '@revisium/schema-toolkit/mocks';
import type { Migration } from '@revisium/schema-toolkit/types';
import {
  init,
  rename,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { TableIdTimeline } from '../table-id-timeline';

const ALPHA = 'alpha';
const BETA = 'beta';
const RENAMES = 16_000;
const GENEROUS_BOUND_MS = 1_000;

describe('TableIdTimeline', () => {
  it('finds the last change of an id before every step of a long history in near-linear time', () => {
    const ledger = renamedBackAndForth(RENAMES);
    const startedAt = performance.now();

    const timeline = new TableIdTimeline(ledger);
    const lastChanges = ledger.map(
      (step) => timeline.lastChangeBefore(step, ALPHA)?.migration.id,
    );

    expect(performance.now() - startedAt).toBeLessThan(GENEROUS_BOUND_MS);
    expect(lastChanges).toEqual([
      undefined,
      ...ledger.slice(0, -1).map(({ id }) => id),
    ]);
  });
});

function renamedBackAndForth(renames: number): Migration[] {
  const ledger: Migration[] = [init(ALPHA, obj({ title: str() }))];

  for (let renamed = 0; renamed < renames; renamed += 1) {
    if (renamed % 2 === 0) {
      ledger.push(rename(ALPHA, BETA));
    } else {
      ledger.push(rename(BETA, ALPHA));
    }
  }

  return ledger;
}
