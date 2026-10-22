import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  documentSchema,
  emptyFile,
  pricedProductSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';
import { TargetAssembler } from 'src/features/partial-changes-poc/assembly/target-assembler.service';
import { DependencyClosure } from 'src/features/partial-changes-poc/dependencies/dependency-closure.service';
import {
  DEFAULT_LIMITS,
  OperationLimitValues,
} from 'src/features/partial-changes-poc/planning/operation-limits.service';
import { SnapshotReader } from 'src/features/partial-changes-poc/snapshot/snapshot-reader.service';

const PRODUCTS = 8;
const EDITED = 3;

const field = (rowId: string) => ({
  tableId: 'products',
  rowId,
  path: '/price',
});
const row = (rowId: string) => ({ tableId: 'products', rowId });
const photo = (rowId: string) => ({
  tableId: 'documents',
  rowId,
  path: '/photo',
});

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

  async function givenUploadedPhotos(kit: PartialChangesTestKit) {
    const scenario = await ChangesScenario.committed(kit, {
      documents: {
        schema: documentSchema,
        rows: {
          d1: { title: 'one', photo: emptyFile },
          d2: { title: 'two', photo: emptyFile },
        },
      },
    });
    for (const rowId of ['d1', 'd2']) {
      await scenario.uploadFile('documents', rowId, 'photo');
      await scenario.patchRow('documents', rowId, { title: 'edited' });
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
        perRowWorkRows: 2,
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
        perRowWorkRows: 0,
        mixedTables: [{ tableId: 'products', linksCopied: 0, linksAdded: 1 }],
      });
    });

    it('counts merged rows with files as rows that need per-row work', async () => {
      const scenario = await givenUploadedPhotos(kit);

      const preview = await scenario.preview('commit', {
        fields: [photo('d1'), photo('d2')],
      });

      expect(preview.estimate).toMatchObject({
        mergedRows: 2,
        perRowWorkRows: 2,
      });
    });
  });

  describe('with small limits', () => {
    let kit: PartialChangesTestKit;
    const limits: OperationLimitValues = {
      ...DEFAULT_LIMITS,
      maxChangedRows: EDITED,
      maxMixedTableLinks: PRODUCTS - 2,
      maxPerRowWork: 1,
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

    it('refuses more merged rows with formulas than the per-row work limit', async () => {
      const scenario = await givenEditedCatalog(kit);

      const preview = await scenario.preview('commit', {
        fields: [field('p1'), field('p2'), field('p3')],
      });

      expect(preview.status).toBe('blocked');
      expect(preview.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'tooLarge',
            message: expect.stringContaining('per-row work'),
          }),
        ]),
      );
    });

    it('refuses more merged rows with files than the per-row work limit', async () => {
      const scenario = await givenUploadedPhotos(kit);

      const result = await scenario.commit({
        fields: [photo('d1'), photo('d2')],
      });

      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [
          expect.objectContaining({
            code: 'tooLarge',
            message: expect.stringContaining('per-row work'),
          }),
        ],
      });
    });

    it('refuses before the target is assembled (N2)', async () => {
      const scenario = await givenEditedCatalog(kit);
      const assemble = jest.spyOn(kit.module.get(TargetAssembler), 'assemble');

      const preview = await scenario.preview('commit', {
        fields: [field('p1'), field('p2'), field('p3')],
      });

      expect(preview.status).toBe('blocked');
      expect(assemble).not.toHaveBeenCalled();
    });

    it('returns tooLarge, not stale, when the Draft grows past the limit after the preview (N4)', async () => {
      const scenario = await givenEditedCatalog(kit);
      const preview = await scenario.preview('revert', { rows: [row('p1')] });
      await scenario.patchRow('products', 'p4', { price: 30 });

      const result = await scenario.revert(
        { rows: [row('p1')] },
        { expected: preview.fingerprint },
      );

      expect(preview.status).toBe('ready');
      expect(result).toMatchObject({
        status: 'blocked',
        blockers: [expect.objectContaining({ code: 'tooLarge' })],
      });
    });

    it('applies an operation within the limits', async () => {
      const scenario = await givenEditedCatalog(kit);

      const result = await scenario.revert({ rows: [row('p1')] });

      expect(result.status).toBe('applied');
    });
  });
});

describe('operation timeout (decision 2)', () => {
  const PLANNING_DELAY_MS = 1500;
  let kit: PartialChangesTestKit;
  let transactionTimeout: string | undefined;

  beforeAll(async () => {
    transactionTimeout = process.env.TRANSACTION_TIMEOUT;
    process.env.TRANSACTION_TIMEOUT = '1000';
    kit = await createPartialChangesTestKit({
      limits: { ...DEFAULT_LIMITS, operationTimeoutMs: 20_000 },
    });
  });

  guardCommittedVersions(() => kit.guard);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    process.env.TRANSACTION_TIMEOUT = transactionTimeout;
    await kit.close();
  });

  async function givenSlowPlanning() {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: pricedProductSchema,
        rows: { p1: { price: 10, qty: 1, total: 0 } },
      },
    });
    await scenario.patchRow('products', 'p1', { price: 20 });
    const reader = kit.module.get(SnapshotReader);
    const read = reader.read.bind(reader);
    jest.spyOn(reader, 'read').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, PLANNING_DELAY_MS));
      return read(...args);
    });
    return scenario;
  }

  it('previews under the operation timeout, not the default transaction timeout', async () => {
    const scenario = await givenSlowPlanning();

    const preview = await scenario.preview('commit', { rows: [row('p1')] });

    expect(preview.status).toBe('ready');
  });

  it('lists under the operation timeout', async () => {
    const scenario = await givenSlowPlanning();

    const page = await scenario.listChanges();

    expect(page.units).toHaveLength(1);
  });

  it('commits under the operation timeout', async () => {
    const scenario = await givenSlowPlanning();

    const result = await scenario.commit({ rows: [row('p1')] });

    expect(result.status).toBe('applied');
  });
});
