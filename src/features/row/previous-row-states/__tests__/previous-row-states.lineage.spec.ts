import { nanoid } from 'nanoid';
import { PreviousRowStatesFixture } from './previous-row-states.fixture';
import { rowState } from './previous-row-states.scenario';

describe('Previous row states lineage', () => {
  let fixture: PreviousRowStatesFixture;

  beforeAll(async () => {
    fixture = await PreviousRowStatesFixture.create();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('follows parent ancestry across a branch without sibling or future leakage', async () => {
    const history = await fixture.given({
      branches: { main: { root: true }, fork: {} },
      revisions: [
        rowState('root', 'A', { branch: 'main' }),
        rowState('parent', 'B', { branch: 'main' }),
        rowState('sibling', 'SIBLING', {
          branch: 'main',
          parent: 'parent',
        }),
        rowState('selected', 'C', {
          branch: 'fork',
          parent: 'parent',
        }),
        rowState('future', 'FUTURE', {
          branch: 'fork',
          parent: 'selected',
        }),
      ],
    });

    const result = await history.at('selected');

    expect(history.project(result)).toEqual([
      {
        revision: 'parent',
        branch: 'main',
        row: { id: 'row', data: { value: 'B' } },
        introducedBy: ['modified'],
      },
      {
        revision: 'root',
        branch: 'main',
        row: { id: 'row', data: { value: 'A' } },
        introducedBy: ['created'],
      },
    ]);
  });

  it('follows nested child to parent to parent-parent fork ancestry', async () => {
    const history = await fixture.given({
      branches: {
        main: { root: true },
        parent: {},
        child: {},
      },
      revisions: [
        rowState('root', 'A', { branch: 'main' }),
        rowState('parent', 'B', {
          branch: 'parent',
          parent: 'root',
        }),
        rowState('selected', 'C', {
          branch: 'child',
          parent: 'parent',
        }),
      ],
    });

    const result = await history.at('selected');

    expect(history.project(result)).toEqual([
      {
        revision: 'parent',
        branch: 'parent',
        row: { id: 'row', data: { value: 'B' } },
        introducedBy: ['modified'],
      },
      {
        revision: 'root',
        branch: 'main',
        row: { id: 'row', data: { value: 'A' } },
        introducedBy: ['created'],
      },
    ]);
  });

  it('returns null when the exact revision/table/row selector is unresolved', async () => {
    const history = await fixture.given({
      revisions: [rowState('root', 'A')],
    });
    const root = history.revision('root');

    await expect(
      fixture.execute({
        revisionId: nanoid(),
        tableId: root.tableId,
        rowId: 'row',
        first: 10,
      }),
    ).resolves.toBeNull();
    await expect(
      fixture.execute({
        revisionId: root.revisionId,
        tableId: root.tableId,
        rowId: 'missing-row',
        first: 10,
      }),
    ).resolves.toBeNull();
  });
});
