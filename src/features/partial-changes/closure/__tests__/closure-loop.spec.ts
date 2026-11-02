import { obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { TARGET_CHECKS } from 'src/features/partial-changes/closure/target-checks';
import { OperationEstimation } from 'src/features/partial-changes/limits/operation-estimator';
import type { Reason } from 'src/features/partial-changes/plan/reason';
import type {
  FieldRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import type { AddressedUnit } from '../../__tests__/support/catalogue-reading';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { ScriptedCheck } from '../../__tests__/support/scripted-checks';

const LIMITED_LINKS = { PARTIAL_CHANGES_MAX_MIXED_TABLE_LINKS: '3' };

const PRODUCTS = 'products';
const NOTES = 'notes';

const productSchema = obj({ title: str() });
const noteSchema = obj({
  title: str(),
  product: str({ foreignKey: PRODUCTS }),
});

const titleOf = (tableId: string, rowId: string) => ({
  kind: 'field' as const,
  tableId,
  rowId,
  path: '/title',
});
const N1 = titleOf(NOTES, 'n1');
const N2 = titleOf(NOTES, 'n2');
const N3 = titleOf(NOTES, 'n3');
const P2 = titleOf(PRODUCTS, 'p2');

type Step = 'estimate' | 'assemble';

describe('DependencyClosure: the loop of estimate, assembly and checks', () => {
  const check = new ScriptedCheck();
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({
      settings: LIMITED_LINKS,
      overrides: [{ provide: TARGET_CHECKS, useValue: [check] }],
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    check.forget();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('estimates again after a required addition and refuses before the assembly that addition would need', async () => {
    const draft = await givenEditedNotesAndProducts(kit);
    const steps = observeSteps(kit);
    check.follow((pass) => [pass.requires(P2, reasonFor(P2, 'needs p2'))]);

    const closure = await draft.closeDependencies('commit', selecting(N1));

    expect(closure).toMatchObject({
      kind: 'tooLarge',
      required: [{ unit: P2, reason: reasonFor(P2, 'needs p2') }],
      blockers: [
        {
          code: 'tooLarge',
          tableId: PRODUCTS,
          message:
            'Assembling products copies up to 4 row links; the limit for one table is 3',
        },
      ],
    });
    expect(steps()).toEqual(['estimate', 'assemble', 'estimate']);
  });

  it('repeats until a pass adds nothing, each required unit keeping the first reason found', async () => {
    const draft = await givenEditedNotesAndProducts(kit);
    const steps = observeSteps(kit);
    check.follow((pass) => [
      ...pass.requiresUntilApplied(N2, reasonFor(N2, 'first')),
      ...pass.requiresUntilApplied(N2, reasonFor(N2, 'second')),
      ...pass.requiresUntilApplied(N3, reasonFor(N3, 'after n2'), {
        after: N2,
      }),
    ]);

    const closure = await draft.closeDependencies('commit', selecting(N1));

    expect(closure).toMatchObject({
      kind: 'closed',
      required: [
        { unit: N2, reason: reasonFor(N2, 'first') },
        { unit: N3, reason: reasonFor(N3, 'after n2') },
      ],
      blockers: [],
    });
    expect(steps()).toEqual([
      'estimate',
      'assemble',
      'estimate',
      'assemble',
      'estimate',
      'assemble',
    ]);
  });

  it.each<{
    unit: string;
    selection: Selection;
    required: AddressedUnit[];
    steps: Step[];
  }>([
    {
      unit: 'a selected unit',
      selection: selecting(N1, N2),
      required: [],
      steps: ['estimate', 'assemble'],
    },
    {
      unit: 'a unit an earlier pass required',
      selection: selecting(N1),
      required: [N2],
      steps: ['estimate', 'assemble', 'estimate', 'assemble'],
    },
  ])(
    'blocks a requirement of $unit as danglingInSource and stops',
    async ({ selection, required, steps: expectedSteps }) => {
      const draft = await givenEditedNotesAndProducts(kit);
      const steps = observeSteps(kit);
      check.follow((pass) => [
        pass.requires(N2, reasonFor(N2, 'still dangles')),
      ]);

      const closure = await draft.closeDependencies('commit', selection);

      expect(closure.required.map(({ unit }) => unit)).toMatchObject(required);
      expect(closure.blockers).toEqual([
        {
          code: 'danglingInSource',
          tableId: NOTES,
          rowId: 'n2',
          path: '/title',
          message: 'No unit can restore consistency: still dangles',
          unit: { ...N2, selector: { fields: [fieldRefOf(N2)] } },
        },
      ]);
      expect(steps()).toEqual(expectedSteps);
    },
  );

  it('blocks a requirement of an excluded unit as requiredExcluded and adds nothing', async () => {
    const draft = await givenEditedNotesAndProducts(kit);
    const steps = observeSteps(kit);
    check.follow((pass) => [pass.requires(N2, reasonFor(N2, 'needs n2'))]);

    const closure = await draft.closeDependencies('commit', {
      ...selecting(N1),
      exclude: selecting(N2),
    });

    expect(closure.required).toEqual([]);
    expect(closure.blockers).toEqual([
      {
        code: 'requiredExcluded',
        tableId: NOTES,
        rowId: 'n2',
        path: '/title',
        message: 'notes/n2/title is required but excluded',
        unit: { ...N2, selector: { fields: [fieldRefOf(N2)] } },
        reason: reasonFor(N2, 'needs n2'),
      },
    ]);
    expect(steps()).toEqual(['estimate', 'assemble']);
  });
});

function selecting(...units: AddressedUnit[]): Selection {
  return { fields: units.map(fieldRefOf) };
}

function fieldRefOf({ tableId, rowId, path }: AddressedUnit): FieldRef {
  return { tableId, rowId: rowId ?? '', path: path ?? '' };
}

function reasonFor(
  { tableId, rowId, path }: AddressedUnit,
  because: string,
): Reason {
  return { code: 'referencedRowMissing', tableId, rowId, path, because };
}

function observeSteps(kit: PartialChangesTestKit): () => Step[] {
  const estimating = jest.spyOn(
    OperationEstimation.prototype,
    'estimateAndGuard',
  );
  const assembling = jest.spyOn(kit.targetAssembler, 'assemble');

  return () =>
    [...callsAs(estimating, 'estimate'), ...callsAs(assembling, 'assemble')]
      .sort(([left], [right]) => left - right)
      .map(([, step]) => step);
}

function callsAs(
  spy: jest.SpyInstance,
  step: Step,
): Array<readonly [number, Step]> {
  return spy.mock.invocationCallOrder.map((order) => [order, step] as const);
}

async function givenEditedNotesAndProducts(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [PRODUCTS]: {
      schema: productSchema,
      rows: Object.fromEntries(
        ['p1', 'p2', 'p3', 'p4', 'p5'].map((rowId) => [
          rowId,
          { title: rowId },
        ]),
      ),
    },
    [NOTES]: {
      schema: noteSchema,
      rows: Object.fromEntries(
        ['n1', 'n2', 'n3'].map((rowId) => [
          rowId,
          { title: rowId, product: 'p1' },
        ]),
      ),
    },
  });

  for (const rowId of ['p2', 'p3']) {
    await draft.updateRow(PRODUCTS, rowId, { title: `${rowId} edited` });
  }

  for (const rowId of ['n1', 'n2', 'n3']) {
    await draft.updateRow(NOTES, rowId, {
      title: `${rowId} edited`,
      product: 'p1',
    });
  }

  return draft;
}
