import type { Row } from 'src/engine-prisma-types';
import type {
  ChangesSnapshot,
  ComparedTable,
  RevisionRows,
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';

export interface SidedRows {
  readonly head?: Row;
  readonly draft?: Row;
}

export class CatalogueTables {
  public readonly pairs: readonly TablePair[];

  private readonly structures: ReadonlyMap<string, TableStructure>;
  private readonly schemaRows: RowsByTableId;
  private readonly viewsRows: RowsByTableId;

  constructor(snapshot: ChangesSnapshot, tables: readonly ComparedTable[]) {
    this.pairs = snapshot.tables;
    this.structures = new Map(
      tables.map(({ identity, structure }) => [identity, structure]),
    );
    this.schemaRows = new RowsByTableId(snapshot.systemRows.schemas);
    this.viewsRows = new RowsByTableId(snapshot.systemRows.views);
  }

  public structureOf({ identity }: TablePair): TableStructure {
    const structure = this.structures.get(identity);

    if (!structure) {
      throw new Error(`Table ${identity} has no structure analysis`);
    }

    return structure;
  }

  public schemaRowsOf(pair: TablePair): SidedRows {
    return this.schemaRows.rowsOf(pair);
  }

  public viewsRowsOf(pair: TablePair): SidedRows {
    return this.viewsRows.rowsOf(pair);
  }
}

export function publicTableIdOf({ identity, head, draft }: TablePair): string {
  return versionOf(identity, draft ?? head).id;
}

export function previousTableIdOf({
  head,
  draft,
}: TablePair): string | undefined {
  if (!head || !draft || head.id === draft.id) {
    return undefined;
  }

  return head.id;
}

export function distinctRows(rows: readonly (Row | undefined)[]): Row[] {
  const distinct = new Map<string, Row>();

  for (const row of rows) {
    if (row) {
      distinct.set(row.versionId, row);
    }
  }

  return [...distinct.values()];
}

class RowsByTableId {
  private readonly head: ReadonlyMap<string, Row>;
  private readonly draft: ReadonlyMap<string, Row>;

  constructor(rows: RevisionRows) {
    this.head = new Map(rows.head.map((row) => [row.id, row]));
    this.draft = new Map(rows.draft.map((row) => [row.id, row]));
  }

  public rowsOf({ head, draft }: TablePair): SidedRows {
    return {
      head: head && this.head.get(head.id),
      draft: draft && this.draft.get(draft.id),
    };
  }
}

function versionOf(
  identity: string,
  version: TableVersion | undefined,
): TableVersion {
  if (!version) {
    throw new Error(`Table ${identity} is in neither revision`);
  }

  return version;
}
