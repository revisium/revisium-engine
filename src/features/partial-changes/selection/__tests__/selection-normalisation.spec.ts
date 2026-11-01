import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  arr,
  num,
  numFormula,
  obj,
  ref,
  str,
} from '@revisium/schema-toolkit/mocks';
import type { JsonPatch } from '@revisium/schema-toolkit/types';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { addField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import type { AddressedUnit } from '../../__tests__/support/catalogue-reading';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import type { RequiredUnitView } from '../../__tests__/support/selection-resolving';

const PRODUCTS = 'products';
const CATEGORIES = 'categories';
const DOCUMENTS = 'documents';
const TAGS = 'tags';

const productSchema = obj({
  code: str(),
  price: num(),
  size: obj({ width: num(), height: num() }),
  labels: arr(str()),
  total: numFormula('price * 2'),
});
const categorySchema = obj({ title: str() });
const tagSchema = obj({ label: str() });
const documentSchema = obj({ title: str(), image: ref(SystemSchemaIds.File) });

const emptyFile = {
  status: '',
  fileId: '',
  url: '',
  fileName: '',
  hash: '',
  extension: '',
  mimeType: '',
  size: 0,
  width: 0,
  height: 0,
};

const addDepthToSize: JsonPatch = {
  op: 'add',
  path: '/properties/size/properties/depth',
  value: num(),
};
const addNotes = addField('notes', arr(str()));

describe('SelectionResolver: normalisation', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each<{
    target: string;
    edit: (draft: ChangesScenario) => Promise<void>;
    selection: Selection;
    required: RequiredUnitView;
  }>([
    {
      target: 'a row of a created table',
      edit: createTagsWithRow,
      selection: { rows: [{ tableId: TAGS, rowId: 't1' }] },
      required: {
        unit: { kind: 'structure', tableId: TAGS },
        reason: {
          code: 'structureBoundData',
          tableId: TAGS,
          rowId: 't1',
          because:
            'the rows of tags exist only with its structure (created or removed table)',
        },
      },
    },
    {
      target: 'a field of a created table',
      edit: createTagsWithRow,
      selection: { fields: [{ tableId: TAGS, rowId: 't1', path: '/label' }] },
      required: {
        unit: { kind: 'structure', tableId: TAGS },
        reason: {
          code: 'structureBoundData',
          tableId: TAGS,
          rowId: 't1',
          path: '/label',
          because:
            'the rows of tags exist only with its structure (created or removed table)',
        },
      },
    },
    {
      target: 'the data of a removed table',
      edit: (draft) => draft.removeTable(CATEGORIES),
      selection: { tableData: [CATEGORIES] },
      required: {
        unit: { kind: 'structure', tableId: CATEGORIES },
        reason: {
          code: 'structureBoundData',
          tableId: CATEGORIES,
          because:
            'the rows of categories exist only with its structure (created or removed table)',
        },
      },
    },
  ])(
    'requires the structure unit for $target',
    async ({ edit, selection, required }) => {
      const draft = await givenCommittedCatalog();
      await edit(draft);

      const resolution = await draft.resolveSelection(selection);

      expect(resolution.selected).toEqual([]);
      expect(resolution.required).toEqual([required]);
    },
  );

  it.each<{
    row: string;
    edit: (draft: ChangesScenario) => Promise<void>;
    rowId: string;
    existence: AddressedUnit;
  }>([
    {
      row: 'created',
      edit: (draft) => draft.createRows(PRODUCTS, { p3: product('three') }),
      rowId: 'p3',
      existence: { kind: 'rowCreate', tableId: PRODUCTS, rowId: 'p3' },
    },
    {
      row: 'deleted',
      edit: (draft) => draft.removeRow(PRODUCTS, 'p2'),
      rowId: 'p2',
      existence: { kind: 'rowDelete', tableId: PRODUCTS, rowId: 'p2' },
    },
    {
      row: 'replaced',
      edit: async (draft) => {
        await draft.removeRow(PRODUCTS, 'p2');
        await draft.createRows(PRODUCTS, { p2: product('reused') });
      },
      rowId: 'p2',
      existence: { kind: 'rowReplace', tableId: PRODUCTS, rowId: 'p2' },
    },
  ])(
    'requires the existence unit for a field of a $row row',
    async ({ edit, rowId, existence }) => {
      const draft = await givenCommittedCatalog();
      await edit(draft);

      const resolution = await draft.resolveSelection({
        fields: [{ tableId: PRODUCTS, rowId, path: '/code' }],
      });

      expect(resolution.selected).toEqual([]);
      expect(resolution.required).toEqual([
        {
          unit: existence,
          reason: {
            code: 'wholeRowUnit',
            tableId: PRODUCTS,
            rowId,
            path: '/code',
            because: `products/${rowId} is created, deleted or replaced as a whole row`,
          },
        },
      ]);
    },
  );

  it('selects the field units inside a pointer to an object', async () => {
    const draft = await givenCommittedCatalog();
    await draft.updateRow(PRODUCTS, 'p1', {
      ...product('one'),
      size: { width: 15, height: 25 },
    });

    const resolution = await draft.resolveSelection({
      fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/size' }],
    });

    expect(resolution.selected).toEqual([
      fieldOfP1('/size/height'),
      fieldOfP1('/size/width'),
    ]);
    expect(resolution.required).toEqual([]);
  });

  it.each<{
    value: string;
    given: () => Promise<ChangesScenario>;
    selection: Selection;
    required: RequiredUnitView;
  }>([
    {
      value: 'an array',
      given: givenEditedLabels,
      selection: {
        fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/labels/0' }],
      },
      required: {
        unit: fieldOfP1('/labels'),
        reason: {
          code: 'atomicValue',
          tableId: PRODUCTS,
          rowId: 'p1',
          path: '/labels/0',
          because:
            '/labels/0 is inside the atomic value /labels of products/p1',
        },
      },
    },
    {
      value: 'a file',
      given: givenUploadedFile,
      selection: {
        fields: [{ tableId: DOCUMENTS, rowId: 'd1', path: '/image/fileId' }],
      },
      required: {
        unit: {
          kind: 'field',
          tableId: DOCUMENTS,
          rowId: 'd1',
          path: '/image',
        },
        reason: {
          code: 'atomicValue',
          tableId: DOCUMENTS,
          rowId: 'd1',
          path: '/image/fileId',
          because:
            '/image/fileId is inside the atomic value /image of documents/d1',
        },
      },
    },
  ])(
    'requires the whole value for a pointer inside $value',
    async ({ given, selection, required }) => {
      const draft = await given();

      const resolution = await draft.resolveSelection(selection);

      expect(resolution.selected).toEqual([]);
      expect(resolution.required).toEqual([required]);
    },
  );

  it.each([
    { position: 'at', path: '/size/depth', selected: [] },
    { position: 'inside', path: '/notes/0', selected: [] },
    {
      position: 'above',
      path: '/size',
      selected: [fieldOfP1('/size/width')],
    },
  ])(
    'requires the structure unit for a pointer $position a changed field and selects the unchanged field units under it',
    async ({ path, selected }) => {
      const draft = await givenChangedFieldsNextToAnEditedWidth();

      const resolution = await draft.resolveSelection({
        fields: [{ tableId: PRODUCTS, rowId: 'p1', path }],
      });

      expect(resolution.selected).toEqual(selected);
      expect(resolution.required).toEqual([
        {
          unit: { kind: 'structure', tableId: PRODUCTS },
          reason: {
            code: 'structureBoundData',
            tableId: PRODUCTS,
            rowId: 'p1',
            path,
            because: `products/p1${path} touches a new or changed field; its values belong to the structure of products`,
          },
        },
      ]);
    },
  );

  it('blocks a pointer to a computed value as not selectable', async () => {
    const draft = await givenCommittedCatalog();
    await draft.updateRow(PRODUCTS, 'p1', { ...product('one'), price: 5 });

    const resolution = await draft.resolveSelection({
      fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/total' }],
    });

    expect(resolution).toEqual({
      selected: [],
      excluded: [],
      required: [],
      blockers: [
        {
          code: 'notSelectable',
          tableId: PRODUCTS,
          rowId: 'p1',
          path: '/total',
          message:
            'products/p1/total is a computed value that follows its inputs',
        },
      ],
      unmatched: {},
    });
  });

  function givenCommittedCatalog(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: product('one'), p2: product('two') },
      },
      [CATEGORIES]: {
        schema: categorySchema,
        rows: { c1: { title: 'first' } },
      },
    });
  }

  async function givenEditedLabels(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.updateRow(PRODUCTS, 'p1', {
      ...product('one'),
      labels: ['sale', 'new'],
    });

    return draft;
  }

  async function givenUploadedFile(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [DOCUMENTS]: {
        schema: documentSchema,
        rows: { d1: { title: 'one', image: emptyFile } },
      },
    });
    await draft.uploadFile(DOCUMENTS, 'd1', 'image');

    return draft;
  }

  async function givenChangedFieldsNextToAnEditedWidth(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.updateTable(PRODUCTS, [addDepthToSize, addNotes]);
    await draft.updateRow(PRODUCTS, 'p1', {
      ...product('one'),
      size: { width: 15, height: 20, depth: 0 },
      notes: [],
    });

    return draft;
  }

  async function createTagsWithRow(draft: ChangesScenario): Promise<void> {
    await draft.createTable(TAGS, tagSchema);
    await draft.createRows(TAGS, { t1: { label: 'one' } });
  }
});

function product(code: string) {
  return {
    code,
    price: 1,
    size: { width: 10, height: 20 },
    labels: ['sale'],
    total: 0,
  };
}

function fieldOfP1(path: string): AddressedUnit {
  return { kind: 'field', tableId: PRODUCTS, rowId: 'p1', path };
}
