import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import { pricedProductSchema } from 'src/features/partial-changes-poc/__tests__/support/schemas';
import { DependencyClosure } from 'src/features/partial-changes-poc/dependencies/dependency-closure.service';
import type { OperationLimitValues } from 'src/features/partial-changes-poc/planning/operation-limits.service';

const PRODUCTS = 8;
const EDITED = 3;

const field = (rowId: string) => ({
  tableId: 'products',
  rowId,
  path: '/price',
});
const row = (rowId: string) => ({ tableId: 'products', rowId });

describe('operation size: estimate and tooLarge (decision 1)', () => {
  async function givenEditedCatalog(kit: PartialChangesTestKit) {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: pricedProductSchema,
        rows: Object.fromEntries(
          Array.from({ length: PRODUCTS }, (_, index) => [
            `p${index + 1}`,
            { price: 10, qty: 1, total: 0 },
          ]),
        ),
      },
    });
    for (let index = 1; index <= EDITED; index++) {
      await scenario.patchRow('products', `p${index}`, {
        price: 20,
        qty: 2,
      });
    }
    return scenario;
  }

  describe('with the default limits', () => {
    let kit: PartialChangesTestKit;

    beforeAll(async () => {
      kit = await createPartialChangesTestKit();
    });

    guardCommittedVersions(() => kit.guard);

    afterAll(async () => {
      await kit.close();
    });

    it('estimates changed rows, merged rows and links copied per mixed table', async () => {
      const scenario = await givenEditedCatalog(kit);

      const preview = await scenario.preview('commit', {
        fields: [field('p1'), field('p2')],
      });

      expect(preview.estimate).toEqual({
        changedRows: EDITED,
        mergedRows: 2,
        mergedRowsWithFormulas: 2,
        mixedTables: [
          { tableId: 'products', linksCopied: PRODUCTS - 2, linksAdded: 2 },
        ],
      });
    });

    it('estimates no copied links for a revert inside the mutable Draft table', async () => {
      const scenario = await givenEditedCatalog(kit);

      const preview = await scenario.preview('revert', { rows: [row('p1')] });

      expect(preview.estimate).toEqual({
        changedRows: EDITED,
        mergedRows: 0,
        mergedRowsWithFormulas: 0,
        mixedTables: [{ tableId: 'products', linksCopied: 0, linksAdded: 1 }],
      });
    });
  });

  describe('with small limits', () => {
    let kit: PartialChangesTestKit;
    const limits: OperationLimitValues = {
      maxChangedRows: EDITED,
      maxMixedTableLinks: PRODUCTS - 2,
      maxFormulaMerges: 1,
    };

    beforeAll(async () => {
      kit = await createPartialChangesTestKit({ limits });
    });

    guardCommittedVersions(() => kit.guard);

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async () => {
      await kit.close();
    });

    it('refuses before planning when the Draft has more changed rows than the limit', async () => {
      const scenario = await givenEditedCatalog(kit);
      await scenario.patchRow('products', 'p4', { price: 30 });
      const revisions = await scenario.revisionCount();
      const closure = jest.spyOn(kit.module.get(DependencyClosure), 'close');

      const result = await scenario.commit({ rows: [row('p1')] });

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [expect.objectContaining({ code: 'tooLarge' })],
      });
      expect(closure).not.toHaveBeenCalled();
      expect(await scenario.revisionCount()).toBe(revisions);
    });

    it('refuses a commit whose mixed table copies more links than the limit', async () => {
      const scenario = await givenEditedCatalog(kit);

      const result = await scenario.commit({ rows: [row('p1')] });

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [
          expect.objectContaining({ code: 'tooLarge', tableId: 'products' }),
        ],
      });
    });

    it('refuses more merged rows with formulas than the limit', async () => {
      const scenario = await givenEditedCatalog(kit);

      const preview = await scenario.preview('commit', {
        fields: [field('p1'), field('p2'), field('p3')],
      });

      expect(preview.status).toBe('blocked');
      expect(preview.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'tooLarge',
            message: expect.stringContaining('formula'),
          }),
        ]),
      );
    });

    it('applies an operation within the limits', async () => {
      const scenario = await givenEditedCatalog(kit);

      const result = await scenario.revert({ rows: [row('p1')] });

      expect(result.status).toBe('applied');
    });
  });
});
