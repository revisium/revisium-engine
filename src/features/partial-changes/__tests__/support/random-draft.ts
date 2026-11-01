import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { num, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { InputJsonValue, Row } from 'src/engine-prisma-types';
import {
  addField,
  moveField,
  removeField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import {
  seededRandom,
  type SeededRandom,
} from 'src/features/share/ledger-replay/__tests__/support/seeded-random';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import { ChangesScenario } from './changes-scenario';
import {
  dataOf,
  type DraftTable,
  DraftTables,
  fieldSchemaOf,
  fieldsOf,
  fileFieldsOf,
  type HeadTable,
  isFile,
  isNumber,
  isPublishedAt,
  isReference,
  plainFieldsOf,
  publishedAtFieldsOf,
  readHeadTables,
  referenceFieldsOf,
  type TableRow,
  type TableShape,
} from './random-draft-tables';

export interface RandomDraftTwins {
  readonly draft: ChangesScenario;
  readonly twin: ChangesScenario;
}

export interface RandomDraftOptions {
  readonly ledgerOnlyDependencies: boolean;
}

interface VacatedRowId extends TableRow {
  readonly rowId: string;
}

const SEED_COUNT = 6;
const FIRST_SEED = 7_919;
const SEED_STRIDE = 104_723;

export const RANDOM_DRAFT_SEEDS = Array.from(
  { length: SEED_COUNT },
  (_, index) => FIRST_SEED + index * SEED_STRIDE,
);

const EDITS_PER_DRAFT = 24;

const EDIT_WEIGHTS = {
  editValue: 4,
  editReference: 2,
  editPublishedAt: 3,
  editMeta: 2,
  uploadFile: 2,
  createRow: 3,
  removeRow: 2,
  replaceRow: 2,
  renameRow: 2,
  renameRowIntoVacatedId: 1,
  createTable: 1,
  renameTable: 1,
  renameTableIntoVacatedId: 1,
  removeTable: 1,
  addField: 1,
  removeField: 1,
  renameField: 1,
  editViews: 2,
  editSharedSchema: 2,
} as const;

type RandomEdit = keyof typeof EDIT_WEIGHTS;

const RANDOM_EDITS = Object.keys(EDIT_WEIGHTS) as RandomEdit[];

const WITH_EVERY_EDIT: RandomDraftOptions = { ledgerOnlyDependencies: true };

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const NOTES = 'notes';
const ADDRESS = 'address';
const RELEASE_EPOCH_MS = Date.parse('2030-01-01T00:00:00.000Z');
const SECOND_MS = 1_000;
const PRICE = 10;

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

const categorySchema = obj({ title: str() });
const productSchema = obj({
  title: str(),
  price: num(),
  category: str({ foreignKey: CATEGORIES }),
  releasedAt: ref(SystemSchemaIds.RowPublishedAt),
  photo: ref(SystemSchemaIds.File),
});
const noteSchema = obj({ text: str() });
const addressSchema = obj({ city: str() });

export async function givenRandomDraft(
  kit: PartialChangesTestKit,
  seed: number,
  options: RandomDraftOptions = WITH_EVERY_EDIT,
): Promise<ChangesScenario> {
  const draft = await givenCommittedCatalogue(kit);

  await writeRandomEdits(draft, seed, options);

  return draft;
}

export async function givenRandomDraftTwins(
  kit: PartialChangesTestKit,
  seed: number,
): Promise<RandomDraftTwins> {
  const draft = await givenCommittedCatalogue(kit);
  const twin = await draft.branchFromHead('twin');

  await writeRandomEdits(draft, seed, WITH_EVERY_EDIT);
  await writeRandomEdits(twin, seed, WITH_EVERY_EDIT);

  return { draft, twin };
}

async function givenCommittedCatalogue(
  kit: PartialChangesTestKit,
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: {
      schema: categorySchema,
      rows: { c1: { title: 'c1' }, c2: { title: 'c2' }, c3: { title: 'c3' } },
    },
    [PRODUCTS]: {
      schema: productSchema,
      rows: {
        p1: product('p1', 'c1'),
        p2: product('p2', 'c1'),
        p3: product('p3', 'c2'),
        p4: product('p4', 'c3'),
      },
    },
    [NOTES]: {
      schema: noteSchema,
      rows: { n1: { text: 'n1' }, n2: { text: 'n2' }, n3: { text: 'n3' } },
    },
  });

  await draft.updateViews(PRODUCTS, viewsOf('Prices', 'price'));
  await draft.createSharedSchema(ADDRESS, addressSchema);
  await draft.commit();

  return draft;
}

async function writeRandomEdits(
  draft: ChangesScenario,
  seed: number,
  options: RandomDraftOptions,
): Promise<void> {
  const writer = new RandomDraftWriter(
    draft,
    seededRandom(seed),
    await readHeadTables(draft),
    options,
  );

  for (let written = 0; written < EDITS_PER_DRAFT; written += 1) {
    await writer.writeRandomEdit(await DraftTables.read(draft));
  }
}

class RandomDraftWriter {
  private freshCount = 0;
  private readonly rowsWithPublishedAtEdits = new Set<string>();

  constructor(
    private readonly draft: ChangesScenario,
    private readonly random: SeededRandom,
    private readonly headTables: ReadonlyMap<string, HeadTable>,
    private readonly options: RandomDraftOptions,
  ) {}

  public writeRandomEdit(tables: DraftTables): Promise<void> {
    switch (this.random.pick(this.applicableEdits(tables))) {
      case 'editValue':
        return this.editValue(tables);
      case 'editReference':
        return this.editReference(tables);
      case 'editPublishedAt':
        return this.editPublishedAt(tables);
      case 'editMeta':
        return this.editMeta(tables);
      case 'uploadFile':
        return this.uploadFile(tables);
      case 'createRow':
        return this.createRow(tables);
      case 'removeRow':
        return this.removeRow(tables);
      case 'replaceRow':
        return this.replaceRow(tables);
      case 'renameRow':
        return this.renameRow(tables);
      case 'renameRowIntoVacatedId':
        return this.renameRowIntoVacatedId(tables);
      case 'createTable':
        return this.createTable(tables);
      case 'renameTable':
        return this.renameTable(tables);
      case 'renameTableIntoVacatedId':
        return this.renameTableIntoVacatedId(tables);
      case 'removeTable':
        return this.removeTable(tables);
      case 'addField':
        return this.addField(tables);
      case 'removeField':
        return this.removeField(tables);
      case 'renameField':
        return this.renameField(tables);
      case 'editViews':
        return this.editViews(tables);
      case 'editSharedSchema':
        return this.editSharedSchema();
    }
  }

  private applicableEdits(tables: DraftTables): RandomEdit[] {
    return RANDOM_EDITS.filter((edit) =>
      this.isApplicable(edit, tables),
    ).flatMap((edit) => Array.from({ length: EDIT_WEIGHTS[edit] }, () => edit));
  }

  private isApplicable(edit: RandomEdit, tables: DraftTables): boolean {
    switch (edit) {
      case 'editValue':
        return tables.withPlainValues().length > 0;
      case 'editReference':
        return tables.withReplaceableReferences().length > 0;
      case 'editPublishedAt':
        return this.publishedAtCandidates(tables).length > 0;
      case 'editMeta':
        return tables.withRows().length > 0;
      case 'uploadFile':
        return tables.withFiles().length > 0;
      case 'createRow':
        return tables.acceptingRows().length > 0;
      case 'removeRow':
        return this.removableRows(tables).length > 0;
      case 'replaceRow':
        return this.replaceableRows(tables).length > 0;
      case 'renameRow':
        return this.renamableRows(tables).length > 0;
      case 'renameRowIntoVacatedId':
        return this.vacatedRowIds(tables).length > 0;
      case 'renameTableIntoVacatedId':
        return (
          this.options.ledgerOnlyDependencies &&
          tables.all.length > 0 &&
          this.vacatedTableIds(tables).length > 0
        );
      case 'removeTable':
        return this.removableTables(tables).length > 0;
      case 'removeField':
        return tables.withSeveralFields().length > 0;
      case 'renameTable':
      case 'addField':
      case 'renameField':
      case 'editViews':
        return tables.all.length > 0;
      case 'createTable':
      case 'editSharedSchema':
        return true;
    }
  }

  private async editValue(tables: DraftTables): Promise<void> {
    const table = this.random.pick(tables.withPlainValues());
    const field = this.random.pick(plainFieldsOf(table));

    await this.updateField(
      table,
      this.random.pick(table.rows),
      field,
      this.freshValueOf(fieldSchemaOf(table, field)),
    );
  }

  private async editReference(tables: DraftTables): Promise<void> {
    const table = this.random.pick(tables.withReplaceableReferences());
    const row = this.random.pick(table.rows);
    const field = this.random.pick(
      referenceFieldsOf(table).filter(
        (candidate) => tables.referenceTargetsOf(table, candidate).length > 1,
      ),
    );
    const targets = tables
      .referenceTargetsOf(table, field)
      .filter((rowId) => rowId !== dataOf(row)[field]);

    await this.updateField(table, row, field, this.random.pick(targets));
  }

  private async editPublishedAt(tables: DraftTables): Promise<void> {
    const { table, row } = this.random.pick(this.publishedAtCandidates(tables));
    const field = this.random.pick(publishedAtFieldsOf(table));

    this.rowsWithPublishedAtEdits.add(row.createdId);

    await this.updateField(table, row, field, this.freshReleaseDate());
  }

  private async editMeta(tables: DraftTables): Promise<void> {
    const table = this.random.pick(tables.withRows());
    const row = this.random.pick(table.rows);

    await this.draft.writeRowColumns(table.id, row.id, {
      meta: { note: this.freshText() },
    });
  }

  private async uploadFile(tables: DraftTables): Promise<void> {
    const table = this.random.pick(tables.withFiles());
    const row = this.random.pick(table.rows);

    await this.draft.uploadFile(
      table.id,
      row.id,
      this.random.pick(fileFieldsOf(table)),
    );
  }

  private async createRow(tables: DraftTables): Promise<void> {
    const table = this.random.pick(tables.acceptingRows());

    await this.draft.createRows(table.id, {
      [this.freshRowId()]: this.freshRowOf(table, tables),
    });
  }

  private async removeRow(tables: DraftTables): Promise<void> {
    const { table, row } = this.random.pick(this.removableRows(tables));

    await this.draft.removeRow(table.id, row.id);
  }

  private async replaceRow(tables: DraftTables): Promise<void> {
    const { table, row } = this.random.pick(this.replaceableRows(tables));

    await this.draft.removeRow(table.id, row.id);
    await this.draft.createRows(table.id, {
      [row.id]: this.freshRowOf(table, tables),
    });
  }

  private async renameRow(tables: DraftTables): Promise<void> {
    const { table, row } = this.random.pick(this.renamableRows(tables));

    await this.draft.renameRow(table.id, row.id, this.freshRowId());
  }

  private async renameRowIntoVacatedId(tables: DraftTables): Promise<void> {
    const { table, row, rowId } = this.random.pick(this.vacatedRowIds(tables));

    await this.draft.renameRow(table.id, row.id, rowId);
  }

  private async createTable(tables: DraftTables): Promise<void> {
    const table: TableShape = {
      id: this.freshTableId(),
      schema: obj(this.newTableFieldsOf(tables)),
    };

    await this.draft.createTable(table.id, table.schema);
    await this.draft.createRows(table.id, {
      [this.freshRowId()]: this.freshRowOf(table, tables),
      [this.freshRowId()]: this.freshRowOf(table, tables),
    });
  }

  private async renameTable(tables: DraftTables): Promise<void> {
    const table = this.random.pick(tables.all);

    await this.draft.renameTable(table.id, this.freshTableId());
  }

  private async renameTableIntoVacatedId(tables: DraftTables): Promise<void> {
    const table = this.random.pick(tables.all);

    await this.draft.renameTable(
      table.id,
      this.random.pick(this.vacatedTableIds(tables)),
    );
  }

  private async removeTable(tables: DraftTables): Promise<void> {
    const table = this.random.pick(this.removableTables(tables));

    await this.draft.removeTable(table.id);
  }

  private async addField(tables: DraftTables): Promise<void> {
    const table = this.random.pick(tables.all);

    await this.draft.updateTable(table.id, [
      addField(this.freshFieldName(), this.random.pick([str(), num()])),
    ]);
  }

  private async removeField(tables: DraftTables): Promise<void> {
    const table = this.random.pick(tables.withSeveralFields());

    await this.draft.updateTable(table.id, [
      removeField(this.random.pick(fieldsOf(table))),
    ]);
  }

  private async renameField(tables: DraftTables): Promise<void> {
    const table = this.random.pick(tables.all);

    await this.draft.updateTable(table.id, [
      moveField(this.random.pick(fieldsOf(table)), this.freshFieldName()),
    ]);
  }

  private async editViews(tables: DraftTables): Promise<void> {
    const table = this.random.pick(tables.all);

    await this.draft.updateViews(
      table.id,
      viewsOf(this.freshText(), this.random.pick(fieldsOf(table))),
    );
  }

  private async editSharedSchema(): Promise<void> {
    const ids = await this.draft.rowIds('draft', SystemTables.SharedSchemas);
    const id = this.random.pick([...ids, this.freshSharedSchemaId()]);
    const schema = obj({ [this.freshFieldName()]: str() });

    if (ids.includes(id)) {
      await this.draft.updateSharedSchema(id, schema);
      return;
    }

    await this.draft.createSharedSchema(id, schema);
  }

  private updateField(
    table: DraftTable,
    row: Row,
    field: string,
    value: InputJsonValue,
  ): Promise<void> {
    return this.draft.updateRow(table.id, row.id, {
      ...dataOf(row),
      [field]: value,
    });
  }

  private newTableFieldsOf(tables: DraftTables): Record<string, JsonSchema> {
    const referenceable = this.referenceableTables(tables);

    if (referenceable.length === 0 || this.random.pick([true, false])) {
      return { label: str() };
    }

    return {
      label: str(),
      ref: str({ foreignKey: this.random.pick(referenceable).id }),
    };
  }

  private referenceableTables(tables: DraftTables): DraftTable[] {
    return tables
      .withRows()
      .filter(
        (table) =>
          this.options.ledgerOnlyDependencies ||
          this.headTableOf(table) !== undefined,
      );
  }

  private publishedAtCandidates(tables: DraftTables): TableRow[] {
    return tables.all
      .filter((table) => publishedAtFieldsOf(table).length === 1)
      .flatMap((table) =>
        table.rows
          .filter((row) => this.keepsItsHeadIdentity(table, row))
          .map((row) => ({ table, row })),
      );
  }

  private keepsItsHeadIdentity(table: DraftTable, row: Row): boolean {
    return (
      this.headTableOf(table)?.rows.some(
        ({ id, createdId }) => id === row.id && createdId === row.createdId,
      ) ?? false
    );
  }

  private removableTables(tables: DraftTables): DraftTable[] {
    return tables
      .unreferenced()
      .filter(({ rows }) => rows.every((row) => !this.hasPublishedAtEdit(row)));
  }

  private removableRows(tables: DraftTables): TableRow[] {
    return this.renamableRows(tables).filter(
      ({ table, row }) => !tables.isReferenced(table.id, row.id),
    );
  }

  private replaceableRows(tables: DraftTables): TableRow[] {
    const accepting = new Set(tables.acceptingRows());

    return this.removableRows(tables).filter(({ table }) =>
      accepting.has(table),
    );
  }

  private renamableRows(tables: DraftTables): TableRow[] {
    return tables.all.flatMap((table) =>
      table.rows
        .filter((row) => !this.hasPublishedAtEdit(row))
        .map((row) => ({ table, row })),
    );
  }

  private vacatedRowIds(tables: DraftTables): VacatedRowId[] {
    return this.renamableRows(tables).flatMap(({ table, row }) =>
      (this.headTableOf(table)?.rows ?? [])
        .filter(({ id }) => !table.rows.some((draftRow) => draftRow.id === id))
        .map(({ id }) => ({ table, row, rowId: id })),
    );
  }

  private vacatedTableIds(tables: DraftTables): string[] {
    const draftTableIds = new Set(tables.all.map(({ id }) => id));

    return [...this.headTables.keys()].filter(
      (tableId) => !draftTableIds.has(tableId),
    );
  }

  private headTableOf(table: DraftTable): HeadTable | undefined {
    const head = this.headTables.get(table.id);

    if (head?.createdId !== table.createdId) {
      return undefined;
    }

    return head;
  }

  private hasPublishedAtEdit(row: Row): boolean {
    return this.rowsWithPublishedAtEdits.has(row.createdId);
  }

  private freshRowOf(table: TableShape, tables: DraftTables): InputJsonValue {
    return Object.fromEntries(
      fieldsOf(table).map((field) => [
        field,
        this.freshFieldValueOf(table, field, tables),
      ]),
    );
  }

  private freshFieldValueOf(
    table: TableShape,
    field: string,
    tables: DraftTables,
  ): InputJsonValue {
    const schema = fieldSchemaOf(table, field);

    if (isPublishedAt(schema)) {
      return '';
    }

    if (isFile(schema)) {
      return emptyFile;
    }

    if (isReference(schema)) {
      return this.random.pick(tables.referenceTargetsOf(table, field));
    }

    return this.freshValueOf(schema);
  }

  private freshValueOf(schema: JsonSchema): InputJsonValue {
    if (isNumber(schema)) {
      return this.fresh();
    }

    return this.freshText();
  }

  private freshReleaseDate(): string {
    return new Date(RELEASE_EPOCH_MS + this.fresh() * SECOND_MS).toISOString();
  }

  private freshText(): string {
    return `v${this.fresh()}`;
  }

  private freshRowId(): string {
    return `r${this.fresh()}`;
  }

  private freshTableId(): string {
    return `t${this.fresh()}`;
  }

  private freshFieldName(): string {
    return `f${this.fresh()}`;
  }

  private freshSharedSchemaId(): string {
    return `s${this.fresh()}`;
  }

  private fresh(): number {
    this.freshCount += 1;

    return this.freshCount;
  }
}

function product(title: string, category: string) {
  return { title, price: PRICE, category, releasedAt: '', photo: emptyFile };
}

function viewsOf(name: string, field: string): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'default',
    views: [{ id: 'default', name, columns: [{ field: `data.${field}` }] }],
  };
}
