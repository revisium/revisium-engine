import { obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { migrationIdOf } from 'src/__tests__/fixtures/stored-ledger';
import { TARGET_CHECKS } from 'src/features/partial-changes/closure/target-checks';
import type {
  CatalogueReason,
  ReasonSite,
} from 'src/features/partial-changes/plan/reason';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { ScriptedCheck } from '../../__tests__/support/scripted-checks';

const CATEGORIES = 'categories';
const BRANDS = 'brands';
const STICKERS = 'stickers';

const titleSchema = obj({ title: str() });

const stickersStructure = { kind: 'structure' as const, tableId: STICKERS };
const committedStickers: Selection = { structures: [{ tableId: STICKERS }] };

const stickersFailingIn = (role: string) => ({
  code: 'ledgerInconsistent',
  tableId: STICKERS,
  message: `The migration ledger of the ${role} cannot replay stickers: Foreign key target "brands" does not exist`,
});

const stillReferencesBrands = (site: ReasonSite): CatalogueReason => ({
  code: 'referencedTableMissing',
  because: 'stickers references brands',
  site,
  references: { kind: 'table', tableId: BRANDS },
});

// The ledger failures of a plan whose closure ends with a requirement of a unit
// it already applies (danglingInSource), raised by a scripted check at a site of
// the failing step of stickers.
describe('ChangePlanner: the ledger steps of unresolved requirements', () => {
  const check = new ScriptedCheck();
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({
      overrides: [{ provide: TARGET_CHECKS, useValue: [check] }],
    });
  });

  afterEach(async () => {
    check.forget();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each<{ site: string; siteOf: (step: string) => ReasonSite }>([
    {
      site: 'a migration site',
      siteOf: (step) => ({
        kind: 'migration',
        tableId: STICKERS,
        migrationId: step,
      }),
    },
    {
      site: 'a tableId site with a migration id',
      siteOf: (step) => ({
        kind: 'tableId',
        tableId: STICKERS,
        migrationId: step,
      }),
    },
  ])(
    'blocks a commit once with danglingInSource for an applied unit required at $site, without the ledger failure of its step',
    async ({ siteOf }) => {
      const draft = await givenStickersOfCreatedBrands();
      const initOfStickers = await migrationIdOf(draft, 'init', STICKERS);
      check.follow((pass) => [
        pass.requires(
          stickersStructure,
          stillReferencesBrands(siteOf(initOfStickers)),
        ),
      ]);

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: committedStickers,
      });

      expect(preview.status).toBe('blocked');
      expect(preview.blockers).toEqual([
        expect.objectContaining({
          code: 'danglingInSource',
          tableId: STICKERS,
        }),
      ]);
    },
  );

  it('keeps the ledger failure of a commit whose unresolved requirement is at a tableId site without a migration id', async () => {
    const draft = await givenStickersOfCreatedBrands();
    check.follow((pass) => [
      pass.requires(
        stickersStructure,
        stillReferencesBrands({ kind: 'tableId', tableId: STICKERS }),
      ),
    ]);

    const preview = await draft.previewChanges({
      operation: 'commit',
      selection: committedStickers,
    });

    expect(preview.blockers).toEqual([
      expect.objectContaining({ code: 'danglingInSource', tableId: STICKERS }),
      stickersFailingIn('new Head'),
      stickersFailingIn('remaining Draft'),
    ]);
  });

  async function givenStickersOfCreatedBrands(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: titleSchema },
    });
    await draft.createTable(BRANDS, titleSchema);
    await draft.createTable(
      STICKERS,
      obj({ brand: str({ foreignKey: BRANDS }) }),
    );

    return draft;
  }
});
