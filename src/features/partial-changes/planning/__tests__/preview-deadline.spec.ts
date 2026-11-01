import { obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { OperationEstimation } from 'src/features/partial-changes/limits/operation-estimator';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { OperationTimeoutException } from 'src/infrastructure/database/operation-timeout.exception';
import {
  passingTheDeadlineAfterRowChecks,
  passingTheDeadlineAfterValidation,
} from '../../__tests__/support/change-preview';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const OPERATION_TIMEOUT_MS = 1_000;
const SHORT_OPERATION_TIMEOUT = {
  PARTIAL_CHANGES_OPERATION_TIMEOUT_MS: String(OPERATION_TIMEOUT_MS),
};

const CATEGORIES = 'categories';
const PRODUCTS = 'products';

const categorySchema = obj({ title: str() });
const productSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});

const categoryOfP1: Selection = {
  fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/category' }],
};

describe('previewChanges under the operation deadline', () => {
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

  it('does not start the fingerprint reads once the deadline passed during validation', async () => {
    const draft = await givenProductOfCreatedCategory();
    passingTheDeadlineAfterValidation(kit, OPERATION_TIMEOUT_MS);
    const fingerprints = jest.spyOn(kit.planFingerprint, 'fingerprintOf');

    await expect(
      draft.previewChanges({
        operation: 'commit',
        selection: categoryOfP1,
        includeRequired: true,
      }),
    ).rejects.toThrow(OperationTimeoutException);
    expect(fingerprints).not.toHaveBeenCalled();
  });

  it('does not start another closure iteration once the deadline passed during the checks', async () => {
    const draft = await givenProductOfCreatedCategory();
    passingTheDeadlineAfterRowChecks(kit, OPERATION_TIMEOUT_MS);
    const estimates = jest.spyOn(
      OperationEstimation.prototype,
      'estimateAndGuard',
    );

    await expect(
      draft.previewChanges({ operation: 'commit', selection: categoryOfP1 }),
    ).rejects.toThrow(OperationTimeoutException);
    expect(estimates).toHaveBeenCalledTimes(1);
  });

  async function givenProductOfCreatedCategory(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', category: 'c1' } },
      },
    });
    await draft.createRows(CATEGORIES, { c9: { title: 'nine' } });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'one', category: 'c9' });

    return draft;
  }
});
