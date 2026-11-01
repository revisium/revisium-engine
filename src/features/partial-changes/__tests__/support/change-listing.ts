import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type {
  ListChangesInput,
  ListChangesResult,
  ListedUnit,
} from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import {
  type ChangesBranch,
  type RowPair,
  unitRowIdOf,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { AddressedUnit } from './catalogue-reading';

export type ListingOptions = Omit<ListChangesInput, 'branch'>;

export interface ChangedRowsRead {
  readonly tableId: string;
  readonly rowIds: readonly string[];
  readonly pairs: number;
}

export interface PageWithReads {
  readonly page: ListChangesResult;
  readonly reads: readonly ChangedRowsRead[];
}

const MAX_PAGES = 1_000;

export function listChanges(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  options: ListingOptions,
): Promise<ListChangesResult> {
  return kit.partialChangesApi.listChanges({ ...options, branch });
}

export async function listEveryPage(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  options: ListingOptions,
): Promise<ListChangesResult[]> {
  const pages = await listEveryPageWithReads(kit, branch, options);

  return pages.map(({ page }) => page);
}

export async function listEveryPageWithReads(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  options: ListingOptions,
): Promise<PageWithReads[]> {
  const reads = new ChangedRowsReads(kit);
  const pages: PageWithReads[] = [];
  let cursor = options.cursor;

  try {
    do {
      const page = await reads.during(() =>
        listChanges(kit, branch, { ...options, cursor }),
      );

      pages.push(page);
      cursor = page.page.nextCursor ?? undefined;
    } while (cursor !== undefined && pages.length < MAX_PAGES);
  } finally {
    reads.stop();
  }

  if (cursor !== undefined) {
    throw new Error(`The listing did not end within ${MAX_PAGES} pages`);
  }

  return pages;
}

export function unitsOfPages(
  pages: readonly ListChangesResult[],
): ListedUnit[] {
  return pages.flatMap(({ units }) => units);
}

export function addressedUnitOfListed(listed: ListedUnit): AddressedUnit {
  const { kind, tableId, previousTableId, rowId, previousRowId } = listed;
  const { path, columns, side } = listed;

  return {
    kind,
    tableId,
    previousTableId,
    rowId,
    previousRowId,
    path,
    columns,
    side,
  };
}

class ChangedRowsReads {
  private readonly spy: jest.SpyInstance;
  private reads: Promise<ChangedRowsRead>[] = [];

  constructor(private readonly kit: PartialChangesTestKit) {
    const reader = kit.snapshotReader;
    const readChangedRows = reader.readChangedRowsFrom.bind(reader);

    this.spy = jest
      .spyOn(reader, 'readChangedRowsFrom')
      .mockImplementation(async (table, keyset) => {
        const pairs = await readChangedRows(table, keyset);

        this.reads.push(this.readOf(table.draftVersionId, pairs));

        return pairs;
      });
  }

  public async during(
    list: () => Promise<ListChangesResult>,
  ): Promise<PageWithReads> {
    this.reads = [];

    const page = await list();

    return { page, reads: await Promise.all(this.reads) };
  }

  public stop(): void {
    this.spy.mockRestore();
  }

  private async readOf(
    tableVersionId: string,
    pairs: readonly RowPair[],
  ): Promise<ChangedRowsRead> {
    const table = await this.kit.prisma.table.findUniqueOrThrow({
      where: { versionId: tableVersionId },
      select: { id: true },
    });

    return {
      tableId: table.id,
      rowIds: [...new Set(pairs.map(unitRowIdOf))],
      pairs: pairs.length,
    };
  }
}
