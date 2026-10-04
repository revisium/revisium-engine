import {
  DraftRevisionState,
  DraftRevisionStateRow,
  DraftRevisionStateTable,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { sameRow, sameTable } from './state-equivalence';

export class SourceVersions {
  private readonly rowsByVersion = new Map<string, DraftRevisionStateRow>();
  private readonly headRowsByCreatedId = new Map<
    string,
    DraftRevisionStateRow[]
  >();
  private readonly otherRowsByCreatedId = new Map<
    string,
    DraftRevisionStateRow[]
  >();
  private readonly headTablesByCreatedId = new Map<
    string,
    DraftRevisionStateTable[]
  >();
  private readonly otherTablesByCreatedId = new Map<
    string,
    DraftRevisionStateTable[]
  >();
  private readonly tablesByVersion = new Map<string, DraftRevisionStateTable>();

  constructor(head: DraftRevisionState, others: DraftRevisionState[]) {
    this.indexState(head, this.headRowsByCreatedId, this.headTablesByCreatedId);
    for (const state of others) {
      this.indexState(
        state,
        this.otherRowsByCreatedId,
        this.otherTablesByCreatedId,
      );
    }
  }

  findReusableRow(
    candidate: DraftRevisionStateRow,
  ): DraftRevisionStateRow | undefined {
    const head = this.headRowsByCreatedId
      .get(candidate.createdId)
      ?.find((row) => sameRow(row, candidate));
    if (head) {
      return head;
    }

    const exact = this.rowsByVersion.get(candidate.versionId);
    if (exact && sameRow(exact, candidate)) {
      return exact;
    }

    return this.otherRowsByCreatedId
      .get(candidate.createdId)
      ?.find((row) => sameRow(row, candidate));
  }

  findReusableTable(
    candidate: DraftRevisionStateTable,
    rows: DraftRevisionStateRow[],
  ): DraftRevisionStateTable | undefined {
    const rowVersionIds = rows.map(({ versionId }) => versionId);
    const head = this.headTablesByCreatedId
      .get(candidate.createdId)
      ?.find((table) => sameTable(table, candidate, rowVersionIds));
    if (head) {
      return { ...head, rows };
    }

    const exact = this.tablesByVersion.get(candidate.versionId);
    if (exact && sameTable(exact, candidate, rowVersionIds)) {
      return { ...exact, rows };
    }

    const other = this.otherTablesByCreatedId
      .get(candidate.createdId)
      ?.find((table) => sameTable(table, candidate, rowVersionIds));
    return other ? { ...other, rows } : undefined;
  }

  private indexState(
    state: DraftRevisionState,
    rowsByCreatedId: Map<string, DraftRevisionStateRow[]>,
    tablesByCreatedId: Map<string, DraftRevisionStateTable[]>,
  ): void {
    for (const table of state.tables) {
      this.addToIndex(tablesByCreatedId, table.createdId, table);
      this.tablesByVersion.set(table.versionId, table);
      for (const row of table.rows) {
        this.addToIndex(rowsByCreatedId, row.createdId, row);
        this.rowsByVersion.set(row.versionId, row);
      }
    }
  }

  private addToIndex<T>(index: Map<string, T[]>, key: string, value: T): void {
    const values = index.get(key) ?? [];
    values.push(value);
    index.set(key, values);
  }
}
