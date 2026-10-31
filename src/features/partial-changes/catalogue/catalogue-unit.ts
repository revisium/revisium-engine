import type { Side, Unit } from 'src/features/partial-changes/catalogue/unit';
import type { RowPair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { WholeColumn } from 'src/features/partial-changes/structure/column-owners';

export interface CatalogueUnit {
  readonly key: string;
  readonly tableIdentity: string;
  readonly rowIdentities: readonly string[];
  readonly side?: Side;
  readonly unit: Unit;
}

export interface CatalogueRow {
  readonly pair: RowPair;
  readonly existence?: string;
  readonly columns: ReadonlyMap<WholeColumn, string>;
  readonly leaves: ReadonlyMap<string, string>;
}
