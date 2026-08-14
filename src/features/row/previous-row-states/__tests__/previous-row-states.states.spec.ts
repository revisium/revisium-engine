import { nanoid } from 'nanoid';
import { PluginService } from 'src/features/plugin/plugin.service';
import { PreviousRowStatesFixture } from './previous-row-states.fixture';
import { rowState, tableState } from './previous-row-states.scenario';

describe('Previous row states', () => {
  let fixture: PreviousRowStatesFixture;

  beforeAll(async () => {
    fixture = await PreviousRowStatesFixture.create();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('returns an empty connection when the selected state is its creation', async () => {
    const history = await fixture.given({
      revisions: [rowState('created', 'A')],
    });

    await expect(history.at('created')).resolves.toEqual(emptyHistory());
  });

  it('returns an empty connection when the selected state creates a row mid-lineage', async () => {
    const history = await fixture.given({
      revisions: [tableState('before-creation'), rowState('created', 'A')],
    });

    await expect(history.at('created')).resolves.toEqual(emptyHistory());
  });

  it('finds creation after older committed revisions without the row', async () => {
    const history = await fixture.given({
      revisions: [
        tableState('oldest'),
        tableState('before-creation'),
        rowState('created', 'A'),
        rowState('selected', 'B'),
      ],
    });

    const result = await history.at('selected');

    expect(history.project(result)).toEqual([
      projectedState('created', 'A', ['created']),
    ]);
  });

  it('returns the previous first-effective persisted state with context', async () => {
    const history = await fixture.given({
      revisions: [rowState('created', 'A'), rowState('selected', 'B')],
    });

    const result = await history.at('selected');

    expect(result?.totalCount).toBe(1);
    expect(result?.pageInfo).toEqual({
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: expect.any(String),
      endCursor: expect.any(String),
    });
    expect(history.project(result)).toEqual([
      projectedState('created', 'A', ['created']),
    ]);
  });

  it('collapses row and table copy-on-write no-ops', async () => {
    const history = await fixture.given({
      revisions: [
        rowState('created', 'A'),
        rowState('modified', 'B'),
        rowState('selected', 'B'),
      ],
    });

    const result = await history.at('selected');

    expect(history.project(result)).toEqual([
      projectedState('created', 'A', ['created']),
    ]);
  });

  it('keeps the pre-rename state after A to B to rename C', async () => {
    const history = await fixture.given({
      revisions: [
        rowState('created', 'A'),
        rowState('modified', 'B'),
        rowState('selected', 'B', { rowId: 'row-c' }),
      ],
    });

    const result = await history.at('selected');

    expect(history.project(result)).toEqual([
      projectedState('modified', 'B', ['modified']),
      projectedState('created', 'A', ['created']),
    ]);
  });

  it('classifies rename plus modification from direct parent to node', async () => {
    const history = await fixture.given({
      revisions: [
        rowState('created', 'A'),
        rowState('renamed-and-modified', 'B', { rowId: 'row-b' }),
        rowState('selected', 'C', { rowId: 'row-b' }),
      ],
    });

    const result = await history.at('selected');

    expect(history.project(result)).toEqual([
      projectedState('renamed-and-modified', 'B', ['renamed', 'modified'], {
        rowId: 'row-b',
      }),
      projectedState('created', 'A', ['created']),
    ]);
  });

  it('classifies a renamed-only previous event', async () => {
    const history = await fixture.given({
      revisions: [
        rowState('created', 'A'),
        rowState('renamed', 'A', { rowId: 'renamed-row' }),
        rowState('selected', 'B', { rowId: 'renamed-row' }),
      ],
    });

    const result = await history.at('selected');

    expect(history.project(result)).toEqual([
      projectedState('renamed', 'A', ['renamed'], { rowId: 'renamed-row' }),
      projectedState('created', 'A', ['created']),
    ]);
  });

  it('keeps non-adjacent A to B to A reversion events', async () => {
    const history = await fixture.given({
      revisions: [
        rowState('created', 'A'),
        rowState('modified', 'B'),
        rowState('selected', 'A'),
      ],
    });

    const result = await history.at('selected');

    expect(history.project(result)).toEqual([
      projectedState('modified', 'B', ['modified']),
      projectedState('created', 'A', ['created']),
    ]);
  });

  it('keeps table rename continuity without creating a row event', async () => {
    const history = await fixture.given({
      revisions: [
        rowState('before-rename', 'A', { tableId: 'old-table' }),
        rowState('selected', 'A', { tableId: 'renamed-table' }),
      ],
    });

    await expect(history.at('selected')).resolves.toEqual(emptyHistory());
  });

  it('does not emit state for excluded persisted metadata changes', async () => {
    const history = await fixture.given({
      revisions: [rowState('created', 'A'), rowState('selected', 'A')],
    });
    await fixture.prisma.row.update({
      where: { versionId: history.rowVersionId('selected') },
      data: {
        meta: { changed: true },
        schemaHash: 'different-schema',
        publishedAt: new Date('2026-08-14T00:00:00.000Z'),
        readonly: true,
      },
    });

    await expect(history.at('selected')).resolves.toEqual(emptyHistory());
  });

  it('does not let unrelated Table copy-on-write create a row event', async () => {
    const history = await fixture.given({
      revisions: [rowState('created', 'A'), rowState('selected', 'A')],
    });
    const unrelatedCreatedId = nanoid();
    for (const revision of history.revisions.values()) {
      await fixture.prisma.table.create({
        data: {
          id: `unrelated-${revision.revisionId}`,
          createdId: unrelatedCreatedId,
          versionId: nanoid(),
          revisions: { connect: { id: revision.revisionId } },
        },
      });
    }

    await expect(history.at('selected')).resolves.toEqual(emptyHistory());
  });

  it('isolates reuse of a row id with a new stable createdId', async () => {
    const history = await fixture.given({
      revisions: [
        rowState('old-record', 'OLD'),
        rowState('selected', 'NEW', { identity: 'replacement' }),
      ],
    });

    await expect(history.at('selected')).resolves.toEqual(emptyHistory());
  });

  it('hydrates valid persisted empty hash fields without plugin computation', async () => {
    const history = await fixture.given({
      revisions: [rowState('created', 'A'), rowState('selected', 'B')],
    });
    await fixture.prisma.row.update({
      where: { versionId: history.rowVersionId('created') },
      data: { hash: '', schemaHash: '' },
    });
    const plugin = fixture.module.get(PluginService);
    const computeRows = jest.spyOn(plugin, 'computeRows');

    const result = await history.at('selected');

    expect(result?.edges[0]?.node.row).toMatchObject({
      hash: '',
      schemaHash: '',
      data: { value: 'A' },
    });
    expect(computeRows).not.toHaveBeenCalled();
    computeRows.mockRestore();
  });
});

function projectedState(
  revision: string,
  value: string,
  introducedBy: readonly string[],
  options: { readonly rowId?: string } = {},
) {
  return {
    revision,
    branch: 'main',
    row: { id: options.rowId ?? 'row', data: { value } },
    introducedBy,
  };
}

function emptyHistory() {
  return {
    edges: [],
    totalCount: 0,
    pageInfo: { hasNextPage: false, hasPreviousPage: false },
  };
}
