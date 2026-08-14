import { nanoid } from 'nanoid';
import { PreviousRowStatesReader } from 'src/features/row/services/previous-row-states.reader';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { PreviousRowStatesFixture } from './previous-row-states.fixture';

describe('PreviousRowStatesReader', () => {
  let fixture: PreviousRowStatesFixture;
  let reader: PreviousRowStatesReader;

  beforeAll(async () => {
    fixture = await PreviousRowStatesFixture.create();
    reader = fixture.module.get(PreviousRowStatesReader);
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('looks up only the selected revision draft state', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [{ rowId: 'row', value: 'A' }],
    });
    await fixture.prisma.revision.update({
      where: { id: scenario.revisionIds[0] as string },
      data: { isDraft: true },
    });

    await expect(
      reader.findSelectedRevision(scenario.revisionIds[0] as string),
    ).resolves.toEqual({ isDraft: true });
    await expect(reader.findSelectedRevision(nanoid())).resolves.toBeNull();
  });

  it('executes the history SQL through one raw-query boundary', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
      ],
    });
    const transactionService = fixture.module.get(TransactionPrismaService);
    const prisma = transactionService.getTransactionOrPrisma();
    const queryRaw = jest.spyOn(prisma, '$queryRaw');

    const rows = await reader.read({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 10,
      afterDepth: null,
      afterRevisionId: null,
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ selectorCount: 1, totalCount: 1n });
    queryRaw.mockRestore();
  });
});
