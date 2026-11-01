import { obj, str } from '@revisium/schema-toolkit/mocks';
import type { JsonPatch } from '@revisium/schema-toolkit/types';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  ChangesScenario,
  type TableFixture,
} from 'src/features/partial-changes/__tests__/support/changes-scenario';
import { completeAsyncMigrationInPlace } from 'src/features/partial-changes/__tests__/support/head-schema-damage';
import {
  addField,
  moveField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { importMigrations, initAt } from './ledger-repair-planning';

export const CATEGORIES = 'categories';
export const PRODUCTS = 'products';
export const TAGS = 'tags';
export const NOTES = 'notes';
export const ALPHAS = 'alphas';
export const BETAS = 'betas';
export const COLOR = 'color';
export const TONE = 'tone';
export const FUTURE_MIGRATION_ID = '2999-01-01T00:00:00.000Z';

export const categorySchema = obj({ title: str() });
export const productSchema = obj({
  code: str(),
  category: str({ foreignKey: CATEGORIES }),
});
export const tagSchema = obj({ label: str() });
export const noteSchema = obj({ text: str() });

export const categories: TableFixture = {
  schema: categorySchema,
  rows: { c1: { title: 'first' } },
};
export const products: TableFixture = {
  schema: productSchema,
  rows: {
    p1: { code: 'one', category: 'c1' },
    p2: { code: 'two', category: 'c1' },
  },
};
export const tags: TableFixture = {
  schema: tagSchema,
  rows: { t1: { label: 'x' } },
};

export const addColor = [addField(COLOR, str())];
export const addTone = [addField(TONE, str())];

export function givenCommittedCatalog(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  return ChangesScenario.committed(kit, {
    [CATEGORIES]: categories,
    [PRODUCTS]: products,
  });
}

export function givenCatalogWithTags(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  return ChangesScenario.committed(kit, {
    [CATEGORIES]: categories,
    [PRODUCTS]: products,
    [TAGS]: tags,
  });
}

export async function givenUnpublishedInPlaceMigration(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCommittedCatalog(kit);
  await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);

  return draft;
}

export async function givenPublishedInPlaceMigration(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenUnpublishedInPlaceMigration(kit);
  await draft.commit();

  return draft;
}

export async function givenTwoDamagedTablesAfterFuturePublication(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await givenCatalogWithTags(kit);
  await importMigrations(kit, draft, [
    initAt(FUTURE_MIGRATION_ID, NOTES, noteSchema),
  ]);
  await draft.commit();
  await completeAsyncMigrationInPlace(kit, draft, PRODUCTS, addColor);
  await completeAsyncMigrationInPlace(kit, draft, TAGS, addTone);

  return draft;
}

export async function givenReciprocalDamage(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [ALPHAS]: { schema: obj({ title: str() }) },
    [BETAS]: {
      schema: obj({ title: str(), alpha: str({ foreignKey: ALPHAS }) }),
    },
  });
  await draft.updateTable(ALPHAS, [
    addField('beta', str({ foreignKey: BETAS })),
  ]);
  await draft.commit();
  await completeAsyncMigrationInPlace(kit, draft, ALPHAS, noteField('alpha'));
  await completeAsyncMigrationInPlace(kit, draft, BETAS, noteField('beta'));
  await draft.updateTable(ALPHAS, renamedNoteField('alpha'));
  await draft.updateTable(BETAS, renamedNoteField('beta'));
  await draft.renameTable(ALPHAS, 'firsts');
  await draft.renameTable(BETAS, 'seconds');

  return draft;
}

function noteField(prefix: string): JsonPatch[] {
  return [addField(`${prefix}Note`, str())];
}

function renamedNoteField(prefix: string): JsonPatch[] {
  return [moveField(`${prefix}Note`, `${prefix}Remark`)];
}
