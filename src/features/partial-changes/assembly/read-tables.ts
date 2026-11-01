import type {
  OutcomeRules,
  RevisionSide,
  TableOutcomeRules,
  TableUnits,
} from 'src/features/partial-changes/assembly/outcome-rules';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import type { CatalogueRow } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';

export interface ReadTable {
  readonly pair: TablePair;
  readonly structure: TableStructure;
  readonly units: TableUnits;
  readonly rows: readonly CatalogueRow[];
}

interface Version {
  readonly id: string;
}

interface VersionPair<T extends Version> {
  readonly identity: string;
  readonly head?: T;
  readonly draft?: T;
}

export function readTablesOf(
  { snapshot, tables, catalogue }: AssemblySource,
  lookup: CatalogueLookup,
): ReadTable[] {
  return [...catalogue.rows].map(([identity, rows]) => {
    const pair = requiredOf(snapshot.tables, identity);

    return {
      pair,
      structure: requiredOf(tables, identity).structure,
      units: unitsOf(pair, lookup),
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

export function versionOn<T extends Version>(
  pair: VersionPair<T>,
  side: RevisionSide,
): T {
  const version = pair[side];

  if (!version) {
    throw new Error(`${publicIdOf(pair)} has no ${side} version`);
  }

  return version;
}

export function publicIdOf({
  identity,
  head,
  draft,
}: VersionPair<Version>): string {
  return draft?.id ?? head?.id ?? identity;
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
