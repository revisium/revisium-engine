import {
  createPersistedReferenceSwapKit,
  productReferences,
  swappedRowIds,
} from './support/persisted-reference-swap';
import { requireResolved } from './support/persisted-dependency-scenario';

describe('Draft Changes dependencies: native row swap origins', () => {
  let kit: Awaited<ReturnType<typeof createPersistedReferenceSwapKit>>;

  beforeAll(async () => {
    kit = await createPersistedReferenceSwapKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('rewrites a Head-inherited atomic value according to its Head binding', async () => {
    const scenario = await kit.givenReferenceSwap();

    const result = await scenario.commitRenames();

    expect(productReferences(result)).toEqual({
      head: { refs: [{ link: 'b', note: 'Head' }] },
      draft: { refs: [{ link: 'a', note: 'Draft' }] },
    });
    expect(requireResolved(result).automatic).toEqual([
      scenario.expectedAutomatic,
    ]);
    expect(swappedRowIds(result, scenario.bindings)).toEqual({
      head: { a: 'b', b: 'a', temporary: false },
      draft: { a: 'b', b: 'a', temporary: false },
    });
  });

  it('keeps a selected Draft atomic value bound to its original Draft target', async () => {
    const scenario = await kit.givenReferenceSwap();

    const result = await scenario.commitRenamesAndAtomicValue();

    expect(productReferences(result)).toEqual({
      head: { refs: [{ link: 'a', note: 'Draft' }] },
      draft: { refs: [{ link: 'a', note: 'Draft' }] },
    });
    expect(requireResolved(result).automatic).toEqual([]);
    expect(swappedRowIds(result, scenario.bindings)).toEqual({
      head: { a: 'b', b: 'a', temporary: false },
      draft: { a: 'b', b: 'a', temporary: false },
    });
  });
});
