import { BadRequestException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PreviousRowStatesFixture } from './previous-row-states.fixture';
import { rowState, tableState } from './previous-row-states.scenario';

describe('Previous row states integrity', () => {
  let fixture: PreviousRowStatesFixture;

  beforeAll(async () => {
    fixture = await PreviousRowStatesFixture.create();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('rejects a Draft selected revision', async () => {
    const history = await fixture.given({
      revisions: [rowState('selected', 'A', { draft: true })],
    });

    await expect(history.at('selected')).rejects.toThrow(BadRequestException);
  });

  it('rejects a Draft revision inside committed ancestry', async () => {
    const history = await fixture.given({
      revisions: [
        rowState('created', 'A'),
        rowState('draft-ancestor', 'B', { draft: true }),
        rowState('selected', 'C'),
      ],
    });

    await expect(history.at('selected')).rejects.toThrow(BadRequestException);
  });

  it('rejects a broken non-start ancestry gap', async () => {
    const history = await fixture.given({
      revisions: [rowState('selected', 'A', { start: false })],
    });

    await expect(history.at('selected')).rejects.toThrow(BadRequestException);
  });

  it('accepts a valid root start when Branch.isRoot is false', async () => {
    const history = await fixture.given({
      branches: { main: { root: false } },
      revisions: [rowState('created', 'A'), rowState('selected', 'B')],
    });

    const result = await history.at('selected');

    expect(history.project(result)).toEqual([
      {
        revision: 'created',
        branch: 'main',
        row: { id: 'row', data: { value: 'A' } },
        introducedBy: ['created'],
      },
    ]);
  });

  it('rejects a non-root fork start whose parent link is missing', async () => {
    const history = await fixture.given({
      branches: { main: { root: true }, fork: {} },
      revisions: [
        rowState('root', 'A', { branch: 'main' }),
        rowState('fork-start', 'B', {
          branch: 'fork',
          parent: 'root',
        }),
        rowState('selected', 'C', { branch: 'fork' }),
      ],
    });
    await fixture.prisma.revision.update({
      where: { id: history.revisionId('fork-start') },
      data: { parentId: null },
    });

    await expect(history.at('selected')).rejects.toThrow(BadRequestException);
  });

  it('rejects a cycle in the selected parent ancestry', async () => {
    const history = await fixture.given({
      revisions: [rowState('root', 'A'), rowState('selected', 'B')],
    });
    await fixture.prisma.revision.update({
      where: { id: history.revisionId('root') },
      data: { parentId: history.revisionId('selected') },
    });

    await expect(history.at('selected')).rejects.toThrow(BadRequestException);
  });

  it('rejects ancestry crossing a Project boundary', async () => {
    const history = await fixture.given({
      branches: {
        ancestor: { root: true, project: 'ancestor-project' },
        selected: { project: 'selected-project' },
      },
      revisions: [
        rowState('root', 'A', { branch: 'ancestor' }),
        rowState('selected', 'B', {
          branch: 'selected',
          parent: 'root',
        }),
      ],
    });

    await expect(history.at('selected')).rejects.toThrow(BadRequestException);
  });

  it('rejects duplicate logical Table and Row states', async () => {
    const duplicateTableHistory = await twoStateHistory(fixture);
    const createdTable = duplicateTableHistory.revision('created');
    await fixture.prisma.table.create({
      data: {
        id: 'duplicate-table-id',
        createdId: createdTable.tableCreatedId,
        versionId: nanoid(),
        revisions: { connect: { id: createdTable.revisionId } },
      },
    });
    await expect(duplicateTableHistory.at('selected')).rejects.toThrow(
      BadRequestException,
    );

    const duplicateRowHistory = await twoStateHistory(fixture);
    const createdRow = duplicateRowHistory.revision('created');
    await fixture.prisma.row.create({
      data: {
        id: 'duplicate-row-id',
        createdId: createdRow.rowCreatedId as string,
        versionId: nanoid(),
        data: { value: 'duplicate' },
        hash: 'duplicate',
        schemaHash: 'test-schema',
        tables: { connect: { versionId: createdRow.tableVersionId } },
      },
    });
    await expect(duplicateRowHistory.at('selected')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects disappearance and older reappearance of one stable Row identity', async () => {
    const history = await fixture.given({
      revisions: [
        rowState('root', 'A'),
        tableState('absent'),
        rowState('selected', 'B'),
      ],
    });

    await expect(history.at('selected')).rejects.toThrow(BadRequestException);
  });
});

function twoStateHistory(fixture: PreviousRowStatesFixture) {
  return fixture.given({
    revisions: [rowState('created', 'A'), rowState('selected', 'B')],
  });
}
