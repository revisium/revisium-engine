import type { Row } from 'src/engine-prisma-types';
import type {
  HeadQualifier,
  Unit,
} from 'src/features/partial-changes/catalogue/unit';
import type { RowPair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { WholeColumn } from 'src/features/partial-changes/structure/column-owners';

export interface CatalogueUnit {
  readonly key: string;
  readonly tableIdentities: readonly string[];
  readonly rowIdentities: readonly string[];
  readonly systemRows: readonly Row[];
  readonly side?: HeadQualifier;
  readonly unit: Unit;
}

export interface CatalogueRow {
  readonly pair: RowPair;
  readonly existence?: string;
  readonly columns: ReadonlyMap<WholeColumn, string>;
  readonly leaves: ReadonlyMap<string, string>;
}
