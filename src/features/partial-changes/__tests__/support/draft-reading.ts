import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { BranchScenario } from 'src/__tests__/fixtures/branch-scenario';
import type { Sql } from 'src/engine-prisma-types';
import type {
  DraftChangesSummary,
  DraftChangesSummaryInput,
} from 'src/features/partial-changes/queries/impl/get-draft-changes-summary.query';
import type {
  DraftRowChangesInput,
  DraftRowItem,
  DraftRowPage,
  RowSelection,
} from 'src/features/partial-changes/queries/impl/get-draft-row-changes.query';
import type {
  DraftTableChangesInput,
  DraftTableItem,
  DraftTablePage,
} from 'src/features/partial-changes/queries/impl/get-draft-table-changes.query';
import type { FieldSelection } from 'src/features/partial-changes/queries/impl/draft-reads';
import type { UnitRef } from 'src/features/partial-changes/selection/unit-refs';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { GetRevisionChangesHandler } from 'src/features/revision-changes/queries/handlers/get-revision-changes.handler';
import { GetRowChangesHandler } from 'src/features/revision-changes/queries/handlers/get-row-changes.handler';
import { GetTableChangesHandler } from 'src/features/revision-changes/queries/handlers/get-table-changes.handler';
import { RevisionChangesApiService } from 'src/features/revision-changes/revision-changes-api.service';
import type {
  RevisionChanges,
  RowChange,
  TableChange,
  TableChangesFilters,
} from 'src/features/revision-changes/types';
import type { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import type { RevisionSide } from './snapshot-reading';

export type DraftTableOptions = Omit<DraftTableChangesInput, 'branch'>;
export type DraftTablePaging = Omit<DraftTableOptions, 'after'>;
export type DraftRowOptions = Omit<DraftRowChangesInput, 'branch'>;
export type DraftRowPaging = Omit<DraftRowOptions, 'after'>;
export type DraftSummaryOptions = Omit<DraftChangesSummaryInput, 'branch'>;
export type NativeTableFilters = Pick<
  TableChangesFilters,
  'changeTypes' | 'search'
>;

export interface NativeComparison {
  readonly revisionId: string;
  readonly compareWithRevisionId: string;
}

export interface TableLinkSets {
  readonly tableId: string;
  readonly versionIds: readonly string[];
}

export interface DraftReadQueries<T> {
  readonly result: T;
  readonly linkSetReads: Readonly<Record<string, number>>;
  readonly nativeDiffReads: readonly string[];
}

interface ExecutingHandler {
  execute(query: unknown): Promise<unknown>;
}

type RawQuery = (query: Sql, ...values: unknown[]) => Promise<unknown>;

const MAX_PAGES = 1_000;
const NATIVE_PAGE_SIZE = 10_000;
const SIDES: readonly RevisionSide[] = ['head', 'draft'];
const NATIVE_DIFF_HANDLERS = [
  GetRowChangesHandler,
  GetTableChangesHandler,
  GetRevisionChangesHandler,
];

export function readDraftTableChanges(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  options: DraftTableOptions,
): Promise<DraftTablePage> {
  return kit.partialChangesApi.draftTableChanges({ ...options, branch });
}

export function readDraftRowChanges(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  options: DraftRowOptions,
): Promise<DraftRowPage> {
  return kit.partialChangesApi.draftRowChanges({ ...options, branch });
}

export async function readEveryDraftRowPage(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  paging: DraftRowPaging,
): Promise<DraftRowPage[]> {
  const pages: DraftRowPage[] = [];
  let after: string | null = null;

  for (let index = 0; index < MAX_PAGES; index++) {
    const page = await readDraftRowChanges(kit, branch, { ...paging, after });

    if (index > 0 && page.edges.length === 0) {
      throw new Error('A page that the previous page said follows is empty');
    }

    pages.push(page);

    if (!page.pageInfo.hasNextPage) {
      return pages;
    }

    after = page.pageInfo.endCursor;
  }

  throw new Error(`The Draft rows did not end within ${MAX_PAGES} pages`);
}

export function rowItemsOf(pages: readonly DraftRowPage[]): DraftRowItem[] {
  return pages.flatMap(({ edges }) => edges.map(({ node }) => node));
}

export function readDraftChangesSummary(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  options: DraftSummaryOptions,
): Promise<DraftChangesSummary> {
  return kit.partialChangesApi.draftChangesSummary({ ...options, branch });
}

export async function readEveryDraftTablePage(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  paging: DraftTablePaging,
): Promise<DraftTablePage[]> {
  const pages: DraftTablePage[] = [];
  let after: string | null = null;

  for (let index = 0; index < MAX_PAGES; index++) {
    const page = await readDraftTableChanges(kit, branch, {
      ...paging,
      after,
    });

    pages.push(page);

    if (!page.pageInfo.hasNextPage) {
      return pages;
    }

    after = page.pageInfo.endCursor;
  }

  throw new Error(`The Draft tables did not end within ${MAX_PAGES} pages`);
}

export function tableItemsOf(
  pages: readonly DraftTablePage[],
): DraftTableItem[] {
  return pages.flatMap(({ edges }) => edges.map(({ node }) => node));
}

export async function readNativeTableChanges(
  kit: PartialChangesTestKit,
  comparison: NativeComparison,
  filters: NativeTableFilters,
): Promise<TableChange[]> {
  const page = await kit.module
    .get(RevisionChangesApiService)
    .tableChanges({ ...comparison, filters, first: NATIVE_PAGE_SIZE });

  return page.edges.map(({ node }) => node);
}

export interface DraftReads {
  readonly tables: readonly DraftTableItem[];
  readonly rows: readonly DraftRowItem[];
  readonly summary: DraftChangesSummary;
}

// Every unit a client reaches from the three reads: table selections, summary items, and row, field and column selections.
export function unitsReachableFrom({
  tables,
  rows,
  summary,
}: DraftReads): UnitRef[] {
  return [
    ...tables.flatMap(({ selection }) =>
      selection.state === 'selectable'
        ? [selection.structure, selection.views].filter(isUnitRef)
        : [],
    ),
    ...summary.sharedSchemas.map(({ unit }) => unit),
    ...summary.transientTables.map(({ structure }) => structure),
    ...summary.viewsOnlyTables.map(({ views }) => views),
    ...rows.flatMap((item) => [
      ...item.selection.units,
      ...unitsOfRowSelection(item.selection),
      ...[...item.fields, ...item.columns].flatMap((change) =>
        unitOfFieldSelection(change.selection),
      ),
      ...linkedUnitsOf(item),
    ]),
  ];
}

// The units an item links to: its id takeover and id exchange, and the renames its references follow.
export function linkedUnitsOf({
  idTakeover,
  idExchange,
  fields,
}: DraftRowItem): UnitRef[] {
  return [
    ...(idTakeover ? [idTakeover.deletion, idTakeover.rename] : []),
    ...(idExchange?.renames ?? []),
    ...fields.flatMap(({ follows }) => (follows ? [follows.unit] : [])),
  ];
}

export async function readNativeRowChanges(
  kit: PartialChangesTestKit,
  comparison: NativeComparison,
): Promise<RowChange[]> {
  const page = await kit.module
    .get(RevisionChangesApiService)
    .rowChanges({ ...comparison, first: NATIVE_PAGE_SIZE });

  return page.edges.map(({ node }) => node);
}

export function readNativeSummary(
  kit: PartialChangesTestKit,
  comparison: NativeComparison,
): Promise<RevisionChanges> {
  return kit.module.get(RevisionChangesApiService).revisionChanges(comparison);
}

export async function linkSetsOf(
  scenario: BranchScenario,
  tableIds: readonly string[],
): Promise<TableLinkSets[]> {
  const tables: TableLinkSets[] = [];

  for (const tableId of tableIds) {
    const versionIds = new Set<string>();

    for (const side of SIDES) {
      if (await scenario.hasTable(side, tableId)) {
        versionIds.add(await scenario.tableVersionId(side, tableId));
      }
    }

    tables.push({ tableId, versionIds: [...versionIds] });
  }

  return tables;
}

// Counts the raw statements that name every version of a table, and every native diff read.
export async function draftReadQueriesDuring<T>(
  kit: PartialChangesTestKit,
  tables: readonly TableLinkSets[],
  read: () => Promise<T>,
): Promise<DraftReadQueries<T>> {
  const queries: Sql[] = [];
  const nativeDiffReads: string[] = [];
  const spies = [
    ...recordingRawQueries(kit.transactionService, queries),
    ...recordingNativeDiffReads(kit, nativeDiffReads),
  ];

  try {
    const result = await read();

    return {
      result,
      linkSetReads: Object.fromEntries(
        tables.map(({ tableId, versionIds }) => [
          tableId,
          queries.filter((query) =>
            versionIds.every((versionId) => query.values.includes(versionId)),
          ).length,
        ]),
      ),
      nativeDiffReads,
    };
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
}

// The raw statements a read runs, with their values.
export async function rawQueriesDuring<T>(
  kit: PartialChangesTestKit,
  read: () => Promise<T>,
): Promise<{ result: T; queries: readonly Sql[] }> {
  const queries: Sql[] = [];
  const spies = recordingRawQueries(kit.transactionService, queries);

  try {
    return { result: await read(), queries };
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
}

function unitsOfRowSelection(selection: RowSelection): UnitRef[] {
  if (selection.state === 'goesWith') {
    return [selection.unit];
  }

  if (selection.state === 'selectable' && selection.structure) {
    return [selection.structure];
  }

  return [];
}

function unitOfFieldSelection(selection: FieldSelection): UnitRef[] {
  if (selection.state === 'unit' || selection.state === 'goesWith') {
    return [selection.unit];
  }

  return [];
}

function isUnitRef(unit: UnitRef | undefined): unit is UnitRef {
  return unit !== undefined;
}

function recordingRawQueries(
  transactionService: TransactionPrismaService,
  queries: Sql[],
): jest.SpyInstance[] {
  const getTransaction =
    transactionService.getTransaction.bind(transactionService);

  return [
    jest
      .spyOn(transactionService, 'getTransaction')
      .mockImplementation(() => recordingClient(getTransaction(), queries)),
  ];
}

function recordingClient<C extends object>(client: C, queries: Sql[]): C {
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);

      if (property === '$queryRaw' && typeof value === 'function') {
        const queryRaw = value.bind(target) as RawQuery;

        return (query: Sql, ...values: unknown[]) => {
          queries.push(query);

          return queryRaw(query, ...values);
        };
      }

      if (typeof value === 'function') {
        return value.bind(target) as unknown;
      }

      return value;
    },
  });
}

function recordingNativeDiffReads(
  kit: PartialChangesTestKit,
  reads: string[],
): jest.SpyInstance[] {
  return NATIVE_DIFF_HANDLERS.map((handlerType) => {
    const handler: ExecutingHandler = kit.module.get(handlerType, {
      strict: false,
    });
    const execute = handler.execute.bind(handler);

    return jest.spyOn(handler, 'execute').mockImplementation((query) => {
      reads.push(handlerType.name);

      return execute(query);
    });
  });
}
