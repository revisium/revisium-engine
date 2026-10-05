import { BadRequestException } from '@nestjs/common';
import { givenReadingScenario } from './support/reading-scenario';
import { useReadingTestKit } from './support/reading-test-kit';

describe('Draft Changes reader: public ID identity', () => {
  const kit = useReadingTestKit();

  it('keeps reused row IDs as two distinct list items and rejects ambiguous details', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { value: 1 },
    });
    await scenario.reuseDraftRowId({ value: 9 });
    const catalogue = await scenario.readCatalogue();

    const rows = await kit().changes.draftChangedRows({
      ...scenario.branch,
      tableId: scenario.tableId,
    });

    expect(rows.totalCount).toBe(2);
    const rowLifecycle = catalogue.entries.filter(
      ({ kind, target }) =>
        kind === 'row' &&
        target.kind === 'row' &&
        target.rowId === scenario.rowId,
    );
    expect(
      rowLifecycle.map(({ classification }) => classification).sort(),
    ).toEqual(['created', 'deleted']);
    expect(rows.edges.map(({ node }) => node.changes).sort()).toEqual([
      ['created'],
      ['deleted'],
    ]);
    expect(
      rows.edges.map(({ node }) => node.refs[0]?.ref.value).sort(),
    ).toEqual(rowLifecycle.map(({ ref }) => ref.value).sort());
    for (const edge of rows.edges) {
      const ref = edge.node.refs[0]?.ref;
      if (!ref) {
        throw new Error(
          'Expected each changed row to carry its lifecycle ref.',
        );
      }
      const selection = await kit().changes.resolveSelection({
        catalogue,
        selection: { include: [{ kind: 'change', ref }] },
      });
      expect(selection).toMatchObject({
        status: 'resolved',
        selected: [expect.objectContaining({ ref })],
      });
    }
    await expect(
      kit().changes.draftRowChanges({
        ...scenario.branch,
        tableId: scenario.tableId,
        rowId: scenario.rowId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps reused table IDs distinct in browsing and rejects ambiguous details', async () => {
    const scenario = await givenReadingScenario(kit(), {
      head: { value: 1 },
    });
    await scenario.reuseDraftTableId();
    const catalogue = await scenario.readCatalogue();

    const tables = await kit().changes.draftChangedTables({
      ...scenario.branch,
    });

    expect(tables.totalCount).toBe(2);
    const tableLifecycle = catalogue.entries.filter(
      ({ kind, target }) =>
        kind === 'table' &&
        target.kind === 'table' &&
        target.tableId === scenario.tableId,
    );
    expect(
      tableLifecycle.map(({ classification }) => classification).sort(),
    ).toEqual(['created', 'deleted']);
    expect(tables.edges.map(({ node }) => node.changes).sort()).toEqual([
      ['created'],
      ['deleted'],
    ]);
    expect(
      tables.edges.map(({ node }) => node.refs[0]?.ref.value).sort(),
    ).toEqual(tableLifecycle.map(({ ref }) => ref.value).sort());
    for (const edge of tables.edges) {
      const ref = edge.node.refs[0]?.ref;
      if (!ref) {
        throw new Error(
          'Expected each changed table to carry its lifecycle ref.',
        );
      }
      const selection = await kit().changes.resolveSelection({
        catalogue,
        selection: { include: [{ kind: 'change', ref }] },
      });
      expect(selection).toMatchObject({
        status: 'resolved',
        selected: [expect.objectContaining({ ref })],
      });
    }
    await expect(
      kit().changes.draftTableChanges({
        ...scenario.branch,
        tableId: scenario.tableId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
