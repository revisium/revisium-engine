import { nanoid } from 'nanoid';
import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  givenDraftProjectWithSchema,
  type DraftProjectScenario,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import type {
  DraftChangesChoice,
  DraftChangesExecuteRequest,
  DraftChangesOperation,
  DraftChangesPlan,
  DraftChangesSelection,
} from './contract';
import type { ChangesTestKit } from './test-kit';
import { all, include } from './select';

export type RowData = Record<string, InputJsonValue | null>;

interface RowChangesInput {
  head: RowData;
  draft: RowData;
  schema?: JsonSchema;
  tableId?: string;
  rowId?: string;
}

export async function givenRowChanges(
  kit: ChangesTestKit,
  input: RowChangesInput,
): Promise<RowChangesScenario> {
  const fixture = await givenDraftProjectWithSchema({
    prismaService: kit.prismaService,
    tableId: input.tableId,
    schema: input.schema ?? schemaForRows(input.head, input.draft),
    row: {
      rowId: input.rowId,
      data: input.head,
      draftData: input.draft,
    },
  });
  return new RowChangesScenario(kit, fixture);
}

export function givenTwoFieldChanges(kit: ChangesTestKit) {
  const secondHeadValue = 10;
  const secondDraftValue = 20;
  const selectedDraftValue = 2;
  return givenRowChanges(kit, {
    head: { a: 1, b: secondHeadValue },
    draft: { a: selectedDraftValue, b: secondDraftValue },
  });
}

export class RowChangesScenario {
  readonly branch;
  tableId: string;
  rowId: string;

  constructor(
    readonly kit: ChangesTestKit,
    readonly initial: DraftProjectScenario,
  ) {
    this.branch = {
      projectId: initial.projectId,
      branchName: initial.branchName,
    };
    this.tableId = initial.tableId;
    this.rowId = initial.rowId;
  }

  fields(...paths: string[]): DraftChangesChoice {
    return {
      kind: 'rowFields',
      tableId: this.tableId,
      rowId: this.rowId,
      paths,
    };
  }

  rows(...rowIds: string[]): DraftChangesChoice {
    return {
      kind: 'rows',
      tableId: this.tableId,
      rowIds: rowIds.length ? rowIds : 'all',
    };
  }

  schemaFields(...paths: string[]): DraftChangesChoice {
    return {
      kind: 'schemaFields',
      tableId: this.tableId,
      paths: paths.length ? paths : 'all',
    };
  }

  plan(operation: DraftChangesOperation, selection = all) {
    return this.kit.changes.planDraftChanges({
      branch: this.branch,
      operation,
      selection,
    });
  }

  execute(
    plan: DraftChangesPlan,
    options: Partial<
      Omit<DraftChangesExecuteRequest, 'branch' | 'planToken'>
    > = {},
  ) {
    return this.kit.changes.executeDraftChanges({
      branch: this.branch,
      planToken: plan.planToken,
      requestId: nanoid(),
      ...options,
    });
  }

  commitFields(...paths: string[]) {
    return this.apply('commit', include(this.fields(...paths)));
  }

  discardFields(...paths: string[]) {
    return this.apply('discard', include(this.fields(...paths)));
  }

  commitAll() {
    return this.apply('commit', all);
  }

  discardAll() {
    return this.apply('discard', all);
  }

  async apply(
    operation: DraftChangesOperation,
    selection: DraftChangesSelection,
  ) {
    const plan = await this.plan(operation, selection);
    if (plan.status !== 'ready') {
      throw new Error(
        `Expected a ready plan, got ${plan.status}: ${JSON.stringify(plan.blockers)}`,
      );
    }
    const result = await this.execute(plan);
    if (result.status !== 'applied') {
      throw new Error(
        `Expected an applied operation: ${JSON.stringify(result)}`,
      );
    }
    return result;
  }

  headRow(rowId = this.rowId) {
    return this.rowAt('head', this.tableId, rowId);
  }

  draftRow(rowId = this.rowId) {
    return this.rowAt('draft', this.tableId, rowId);
  }

  originalHeadRow() {
    return this.rowAt(
      this.initial.headRevisionId,
      this.initial.tableId,
      this.initial.rowId,
    );
  }

  async rowAt(role: string, tableId: string, rowId: string) {
    const revisionId = await this.revisionId(role);
    const row = await this.kit.prismaService.row.findFirst({
      where: {
        id: rowId,
        tables: {
          some: { id: tableId, revisions: { some: { id: revisionId } } },
        },
      },
      select: { data: true },
    });
    return row?.data as RowData | undefined;
  }

  async revisionId(role: string): Promise<string> {
    if (role !== 'head' && role !== 'draft') {
      return role;
    }
    const revision = await this.kit.prismaService.revision.findFirstOrThrow({
      where: {
        branchId: this.initial.branchId,
        ...(role === 'head' ? { isHead: true } : { isDraft: true }),
      },
      select: { id: true },
    });
    return revision.id;
  }

  async schema(role: 'head' | 'draft') {
    const value = await this.rowAt(role, SystemTables.Schema, this.tableId);
    return value as unknown as JsonSchema;
  }

  async schemaField(role: 'head' | 'draft', name: string) {
    const schema = await this.schema(role);
    const properties = (
      schema as unknown as { properties: Record<string, unknown> }
    ).properties;
    return properties[name];
  }

  async changeRef(kind: string) {
    const pageSize = 100;
    const page = await this.browseRows({ first: pageSize });
    const leaf = page.edges
      .flatMap(({ node }) => node.refs)
      .find((item) => item.kind === kind && item.selectable);
    if (!leaf) {
      throw new Error(`No selectable ${kind} row change was found.`);
    }
    return leaf.ref;
  }

  async tamperDraftRow(data: RowData) {
    const revisionId = await this.revisionId('draft');
    const row = await this.kit.prismaService.row.findFirstOrThrow({
      where: {
        id: this.rowId,
        tables: {
          some: { id: this.tableId, revisions: { some: { id: revisionId } } },
        },
      },
    });
    await this.kit.prismaService.row.update({
      where: { versionId: row.versionId },
      data: { data },
    });
  }

  async updateDraftRow(data: RowData) {
    await this.kit.draftApiService.apiUpdateRow({
      revisionId: await this.revisionId('draft'),
      tableId: this.tableId,
      rowId: this.rowId,
      data,
    });
  }

  async patchSchema(patches: JsonPatch[]) {
    await this.kit.draftApiService.apiUpdateTable({
      revisionId: await this.revisionId('draft'),
      tableId: this.tableId,
      patches,
    });
  }

  async renameRow(nextRowId: string) {
    await this.kit.draftApiService.apiRenameRow({
      revisionId: await this.revisionId('draft'),
      tableId: this.tableId,
      rowId: this.rowId,
      nextRowId,
    });
    this.rowId = nextRowId;
  }

  async renameTable(nextTableId: string) {
    await this.kit.draftApiService.apiRenameTable({
      revisionId: await this.revisionId('draft'),
      tableId: this.tableId,
      nextTableId,
    });
    this.tableId = nextTableId;
  }

  async createRow(rowId: string, data: RowData) {
    await this.kit.draftApiService.apiCreateRow({
      revisionId: await this.revisionId('draft'),
      tableId: this.tableId,
      rowId,
      data,
    });
  }

  async removeRow(rowId = this.rowId) {
    await this.kit.draftApiService.apiRemoveRow({
      revisionId: await this.revisionId('draft'),
      tableId: this.tableId,
      rowId,
    });
  }

  async createTable(tableId: string) {
    await this.kit.draftApiService.apiCreateTable({
      revisionId: await this.revisionId('draft'),
      tableId,
      schema: (await this.schema('head')) as unknown as InputJsonValue,
    });
  }

  async removeTable() {
    await this.kit.draftApiService.apiRemoveTable({
      revisionId: await this.revisionId('draft'),
      tableId: this.tableId,
    });
  }

  async hasTable(role: 'head' | 'draft', tableId = this.tableId) {
    const revisionId = await this.revisionId(role);
    return (
      (await this.kit.prismaService.table.count({
        where: { id: tableId, revisions: { some: { id: revisionId } } },
      })) > 0
    );
  }

  browseRows(page = {}) {
    return this.kit.changes.draftChangedRows(this.branch, this.tableId, page);
  }

  rowChanges(page = {}) {
    return this.kit.changes.draftRowChanges(
      this.branch,
      this.tableId,
      this.rowId,
      page,
    );
  }

  snapshot() {
    return this.kit.prismaService.branch.findUniqueOrThrow({
      where: { id: this.initial.branchId },
      include: {
        revisions: {
          orderBy: { id: 'asc' },
          include: {
            tables: {
              orderBy: { versionId: 'asc' },
              include: {
                rows: {
                  orderBy: { versionId: 'asc' },
                  include: { fileBlobs: { orderBy: { id: 'asc' } } },
                },
              },
            },
          },
        },
      },
    });
  }
}

function schemaForRows(head: RowData, draft: RowData): JsonSchema {
  const values = { ...head, ...draft };
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(values),
    properties: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        schemaForValue(value ?? head[key]),
      ]),
    ),
  } as JsonSchema;
}

function schemaForValue(value: InputJsonValue | null | undefined): JsonSchema {
  if (typeof value === 'number') {
    return { type: 'number', default: 0 } as JsonSchema;
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', default: false } as JsonSchema;
  }
  if (typeof value === 'string' || value === null || value === undefined) {
    return { type: 'string', default: '' } as JsonSchema;
  }
  if (Array.isArray(value)) {
    return { type: 'array', items: schemaForValue(value[0]) } as JsonSchema;
  }
  return schemaForRows(value as RowData, value as RowData);
}
