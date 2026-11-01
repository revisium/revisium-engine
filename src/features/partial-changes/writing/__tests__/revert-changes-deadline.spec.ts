import { obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { branchContentsOf } from 'src/features/migration/__tests__/support/ledger-repair-planning';
import { ChangePlanner } from 'src/features/partial-changes/planning/change-planner';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { OperationTimeoutException } from 'src/infrastructure/database/operation-timeout.exception';
import { passingTheDeadlineAfterValidation } from '../../__tests__/support/change-preview';
import { recordEndpointNotifications } from '../../__tests__/support/change-reverting';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const OPERATION_TIMEOUT_MS = 1_000;
const SHORT_OPERATION_TIMEOUT = {
  PARTIAL_CHANGES_OPERATION_TIMEOUT_MS: String(OPERATION_TIMEOUT_MS),
};

const CATEGORIES = 'categories';

const categorySchema = obj({ title: str() });

const titleOfC1: Selection = {
  fields: [{ tableId: CATEGORIES, rowId: 'c1', path: '/title' }],
};

describe('revertChanges under the operation deadline', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({
      settings: SHORT_OPERATION_TIMEOUT,
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('fails with OperationTimeoutException when planning outlasts the deadline, without a retry, and writes and notifies nothing', async () => {
    const draft = await givenEditedCategory();
    const contents = await branchContentsOf(kit, draft);
    const plans = jest.spyOn(kit.module.get(ChangePlanner), 'plan');
    const notifications = recordEndpointNotifications(kit, () =>
      Promise.resolve(undefined),
    );
    passingTheDeadlineAfterValidation(kit, OPERATION_TIMEOUT_MS);

    await expect(draft.revertChanges({ selection: titleOfC1 })).rejects.toThrow(
      OperationTimeoutException,
    );

    expect(plans).toHaveBeenCalledTimes(1);
    expect(notifications).toEqual([]);
    expect(await branchContentsOf(kit, draft)).toEqual(contents);
  });

  async function givenEditedCategory(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
    });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'uno' });

    return draft;
  }
});
