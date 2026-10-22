import {
  CatalogueTable,
  ChangeCatalogue,
  structureUnitOfOwner,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import type { UnitKind } from 'src/features/partial-changes-poc/partial-changes.types';
import { SystemTables } from 'src/features/share/system-tables.consts';

export interface RemainingUnitsInput {
  catalogue: ChangeCatalogue;
  applied: ReadonlySet<string>;
}

export function keepsNoUnits(
  table: CatalogueTable,
  input: RemainingUnitsInput,
): boolean {
  if (table.kind === 'system') {
    return !systemTableKeepsUnits(table.tableId, input);
  }
  return ownUnitsOf(table).every((key) => input.applied.has(key));
}

function ownUnitsOf(table: CatalogueTable): string[] {
  return [...table.unitKeys, table.structureUnit, table.viewsUnit].filter(
    (key): key is string => key !== undefined,
  );
}

function systemTableKeepsUnits(
  systemTableId: string,
  input: RemainingUnitsInput,
): boolean {
  switch (systemTableId) {
    case SystemTables.Schema:
      return keepsUnitsOfKind(input, 'structure');
    case SystemTables.Migration:
      return (
        keepsUnitsOfKind(input, 'structure') || keepsUnownedMigrations(input)
      );
    case SystemTables.Views:
      return (
        keepsUnitsOfKind(input, 'structure') || keepsUnitsOfKind(input, 'views')
      );
    case SystemTables.SharedSchemas:
      return keepsUnitsOfKind(input, 'sharedSchema');
    default:
      return true;
  }
}

function keepsUnitsOfKind(input: RemainingUnitsInput, kind: UnitKind): boolean {
  for (const unit of input.catalogue.units.values()) {
    if (unit.kind === kind && !input.applied.has(unit.key)) {
      return true;
    }
  }
  return false;
}

function keepsUnownedMigrations(input: RemainingUnitsInput): boolean {
  const { ledger } = input.catalogue;
  return ledger.pending.some(
    (entry) =>
      !input.applied.has(
        structureUnitOfOwner(
          input.catalogue,
          ledger.attribution.ownerOf.get(entry.version.versionId),
        ),
      ),
  );
}
