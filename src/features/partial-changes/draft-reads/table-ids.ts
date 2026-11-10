import { previousTableIdOf } from 'src/features/partial-changes/catalogue/catalogue-tables';
import {
  publicTableIdOf,
  type TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';

// How a Draft read names a table: its Draft id, else its Head id, and the Head id of a renamed table.
export interface TableIds {
  readonly tableId: string;
  readonly previousTableId?: string;
}

export function tableIdsOf(pair: TablePair): TableIds {
  const tableId = publicTableIdOf(pair);
  const previousTableId = previousTableIdOf(pair);

  if (previousTableId === undefined) {
    return { tableId };
  }

  return { tableId, previousTableId };
}
