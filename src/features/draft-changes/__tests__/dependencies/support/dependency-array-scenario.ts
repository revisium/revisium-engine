import {
  buildCatalogue,
  givenCatalogueScenario,
} from 'src/features/draft-changes/__tests__/catalogue/support/catalogue-scenario';
import {
  schemaWith,
  selectedCandidateData,
} from 'src/features/draft-changes/__tests__/candidates/support/candidate-scenario';
import {
  arraySchema,
  objectSchema,
  rowInput,
  stringField,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';
import { resolveSelection } from 'src/features/draft-changes/__tests__/selection/support/selection-fixture';
import type { CalculateDataCandidatesQueryData } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';

export async function givenTwoArrayReferencesWithRenamedTarget(): Promise<
  Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>
> {
  const schema = schemaWith({
    links: arraySchema(
      objectSchema({
        target: {
          type: 'string',
          default: 'a',
          foreignKey: 'products',
        },
      }),
    ),
    note: stringField(),
  });
  const scenario = await givenCatalogueScenario({
    headSchema: schema,
    draftSchema: schema,
    headRows: [
      rowInput('a', { links: [], note: 'A' }),
      rowInput('x', { links: [], note: 'X' }),
      rowInput('source', {
        links: [{ target: 'a' }, { target: 'x' }],
        note: 'Head',
      }),
    ],
    draftRows: [
      rowInput('a', { links: [], note: 'A' }),
      rowInput('x', { links: [], note: 'X' }),
      rowInput('source', {
        links: [{ target: 'b' }, { target: 'x' }],
        note: 'Draft',
      }),
    ],
    headRowIds: { a: 'a', x: 'x', source: 'source' },
    draftRowIds: { a: 'b', x: 'x', source: 'source' },
  });
  const catalogue = await buildCatalogue(scenario);
  const rename = catalogue.entries.find(
    (entry) =>
      entry.kind === 'row' &&
      entry.classification === 'renamed' &&
      entry.target.kind === 'row' &&
      entry.target.rowCreatedId === 'a',
  );
  if (!rename) {
    throw new Error('Expected target row rename.');
  }
  const selection = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: rename.ref }],
  });
  if (selection.status !== 'resolved') {
    throw new Error('Expected target row rename selection.');
  }
  return selectedCandidateData(
    scenario.snapshot,
    catalogue,
    'commit',
    selection,
  );
}

export async function givenSelfRowRenameWithDeniedArrayReference(): Promise<{
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
}> {
  const schema = schemaWith({
    links: arraySchema({
      type: 'string',
      default: '',
      foreignKey: 'products',
    }),
    note: stringField(),
  });
  const scenario = await givenCatalogueScenario({
    headSchema: schema,
    draftSchema: schema,
    headRows: [rowInput('product', { links: ['product'], note: 'Head' })],
    draftRows: [
      rowInput('product', {
        links: ['renamed-product'],
        note: 'Draft',
      }),
    ],
    headRowIds: { product: 'product' },
    draftRowIds: { product: 'renamed-product' },
  });
  const catalogue = await buildCatalogue(scenario);
  const rename = catalogue.entries.find(
    (entry) =>
      entry.kind === 'row' &&
      entry.classification === 'renamed' &&
      entry.target.kind === 'row' &&
      entry.target.rowCreatedId === 'product',
  );
  if (!rename) {
    throw new Error('Expected a renamed row fixture.');
  }
  const selection = await resolveSelection(catalogue, {
    include: [{ kind: 'change', ref: rename.ref }],
    exclude: [
      {
        kind: 'rowFields',
        tableId: 'products',
        rowId: 'product',
        paths: ['/links'],
      },
    ],
  });
  if (selection.status !== 'resolved') {
    throw new Error('Expected row-rename selection to resolve.');
  }
  return {
    data: selectedCandidateData(
      scenario.snapshot,
      catalogue,
      'commit',
      selection,
    ),
  };
}
