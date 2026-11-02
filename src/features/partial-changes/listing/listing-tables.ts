import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import { ListingValidationError } from 'src/features/partial-changes/listing/listing-validation-error';
import {
  type ChangesSnapshot,
  type ComparedTable,
  hasDifferentVersions,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { ComparedSnapshot } from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

export interface ListingTable {
  readonly tableId: string;
  readonly units: readonly CatalogueUnit[];
  readonly changedRows?: ComparedTable;
}

interface CollectedTable {
  readonly tableId: string;
  readonly units: CatalogueUnit[];
  changedRows?: ComparedTable;
}

type IdentityFilter = (identities: readonly string[]) => boolean;

export function listingTablesOf(
  compared: ComparedSnapshot,
  tableUnits: readonly CatalogueUnit[],
  tableId: string | undefined,
): ListingTable[] {
  const isListed = identityFilterOf(compared.snapshot, tableId);
  const tables = new ListingTables();

  for (const unit of tableUnits) {
    if (isListed(unit.tableIdentities)) {
      tables.addUnit(unit);
    }
  }

  const changed = tablesWithChangedRows(compared);

  for (const { identity, draft } of compared.snapshot.tables) {
    const table = changed.get(identity);

    if (draft && table && isListed([identity])) {
      tables.addChangedRows(draft.id, table);
    }
  }

  return tables.inListingOrder();
}

class ListingTables {
  private readonly tables = new Map<string, CollectedTable>();

  public addUnit(unit: CatalogueUnit): void {
    this.tableAt(unit.unit.tableId).units.push(unit);
  }

  public addChangedRows(tableId: string, table: ComparedTable): void {
    this.tableAt(tableId).changedRows = table;
  }

  public inListingOrder(): ListingTable[] {
    return [...this.tables.values()].sort((left, right) =>
      compareCodePoints(left.tableId, right.tableId),
    );
  }

  private tableAt(tableId: string): CollectedTable {
    const table = this.tables.get(tableId) ?? { tableId, units: [] };

    this.tables.set(tableId, table);

    return table;
  }
}

function identityFilterOf(
  snapshot: ChangesSnapshot,
  tableId: string | undefined,
): IdentityFilter {
  if (tableId === undefined) {
    return () => true;
  }

  const identity = identityNamed(snapshot, tableId);

  return (identities) => identities.includes(identity);
}

function identityNamed(snapshot: ChangesSnapshot, tableId: string): string {
  const pair =
    snapshot.tables.find(({ draft }) => draft?.id === tableId) ??
    snapshot.tables.find(({ head }) => head?.id === tableId);

  if (!pair) {
    throw new ListingValidationError(
      `tableId "${tableId}" names no Head or Draft table`,
    );
  }

  return pair.identity;
}

function tablesWithChangedRows({
  tables,
  headSchema,
}: ComparedSnapshot): ReadonlyMap<string, ComparedTable> {
  const changed = tables.filter(
    (table) =>
      hasDifferentVersions(table) &&
      !headSchema.refusedTablesByIdentity.has(table.identity),
  );

  return new Map(changed.map((table) => [table.identity, table]));
}
