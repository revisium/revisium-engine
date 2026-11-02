import type {
  OutcomeRules,
  TableOutcomeRules,
  TableUnits,
} from 'src/features/partial-changes/assembly/outcome-rules';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import type { CatalogueLookup } from 'src/features/partial-changes/catalogue/catalogue-lookup';
import type { CatalogueRow } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';

export interface ReadTable {
  readonly pair: TablePair;
  readonly structure: TableStructure;
  readonly units: TableUnits;
  readonly rows: readonly CatalogueRow[];
}

export function readTablesOf({
  snapshot,
  tables,
  catalogue,
}: AssemblySource): ReadTable[] {
  return [...catalogue.rows].map(([identity, rows]) => {
    const pair = requiredOf(snapshot.tables, identity);

    return {
      pair,
      structure: requiredOf(tables, identity).structure,
      units: unitsOf(pair, catalogue.lookup),
      rows,
    };
  });
}

export function tableRulesOf(
  rules: OutcomeRules,
  { units, structure }: ReadTable,
): TableOutcomeRules {
  return rules.forTable({ units, structureDiffers: structure.differs });
}

function unitsOf(pair: TablePair, lookup: CatalogueLookup): TableUnits {
  return {
    structure: lookup.tableUnitOf('structure', pair)?.key,
    rows: lookup.rowLevelUnitsOf(pair).map(({ key }) => key),
  };
}

function requiredOf<T extends { readonly identity: string }>(
  items: readonly T[],
  identity: string,
): T {
  const item = items.find((candidate) => candidate.identity === identity);

  if (!item) {
    throw new Error(`Table ${identity} is not in the compared snapshot`);
  }

  return item;
}
