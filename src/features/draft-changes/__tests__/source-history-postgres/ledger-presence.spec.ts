import {
  expectBlocked,
  expectTraced,
} from '../source-history/support/source-results';
import { productsSchema } from '../source-history/support/source-schemas';
import {
  createSourceHistoryTestKit,
  type SourceHistoryTestKit,
} from './support/source-history-scenario';

describe('Draft Changes source history: ledger presence', () => {
  let kit: SourceHistoryTestKit;

  beforeAll(async () => {
    kit = await createSourceHistoryTestKit();
  });

  afterAll(async () => {
    await kit?.close();
  });

  it('reports an unrecorded branch when neither revision keeps ledger rows', async () => {
    const project = await kit.givenProjectWithoutDraftLedger();
    await project.createTable('products', productsSchema);

    const result = await project.trace();

    expect(result).toEqual({ status: 'unrecorded' });
  });

  it('traces every Draft ledger event when Head has no ledger table', async () => {
    const project = await kit.givenProjectWithoutHeadLedger();
    await project.createTable('products', productsSchema);

    const history = expectTraced(await project.trace());

    expect(
      history.pendingEvents.map(({ migration }) => migration.changeType),
    ).toEqual(['init']);
  });

  it('blocks a Draft whose committed ledger row was removed out of band', async () => {
    const project = await kit.givenProject();
    await project.createTable('products', productsSchema);
    await project.commit();
    await project.removeFirstDraftLedgerRow();

    const result = await project.trace();

    expectBlocked(result, 'SOURCE_LEDGER_INVALID');
  });
});
