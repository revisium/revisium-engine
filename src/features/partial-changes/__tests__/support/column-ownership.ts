import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { Row } from 'src/engine-prisma-types';
import type {
  CatalogueRow,
  CatalogueUnit,
} from 'src/features/partial-changes/catalogue/catalogue-unit';
import { structureUnitKey } from 'src/features/partial-changes/catalogue/unit-key';
import type {
  ComparedTable,
  RowPair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { WholeColumn } from 'src/features/partial-changes/structure/column-owners';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import type { CatalogueView } from './catalogue-reading';

const EXISTENCE_KINDS: readonly string[] = [
  'rowCreate',
  'rowDelete',
  'rowReplace',
];

const WHOLE_COLUMN_EQUALITY: Readonly<
  Record<WholeColumn, (head: Row, draft: Row) => boolean>
> = {
  id: (head, draft) => head.id === draft.id,
  publishedAt: (head, draft) =>
    head.publishedAt.getTime() === draft.publishedAt.getTime(),
  meta: (head, draft) => deepEqual(head.meta, draft.meta),
  schemaHash: (head, draft) => head.schemaHash === draft.schemaHash,
};

const WHOLE_COLUMNS = Object.keys(WHOLE_COLUMN_EQUALITY) as WholeColumn[];

interface Claimant {
  readonly name: string;
  readonly key: string;
}

interface Difference {
  readonly name: string;
  readonly claimants: readonly Claimant[];
  readonly recordedOwner: string | undefined;
  readonly followsInputs: boolean;
}

interface Leaf {
  readonly pointer: JsonPointer;
  readonly changed: boolean;
  readonly followsInputs: boolean;
}

export function expectEveryDifferenceOwnedOnce(view: CatalogueView): void {
  expect(ownershipViolationsOf(view)).toEqual([]);
}

function ownershipViolationsOf(view: CatalogueView): string[] {
  return view.tables.flatMap((table) => {
    const pairs = view.changedRows.get(table.identity) ?? [];
    const rows = view.catalogue.rows.get(table.identity) ?? [];
    const units = view.catalogue.units.filter(
      (unit) => unit.tableIdentity === table.identity,
    );

    return [
      ...pairs.flatMap((pair) => rowViolations(table, pair, rows, units)),
      ...unitsOfNoChangedRow(units, pairs).map(
        (unit) => `${describeUnit(unit)} belongs to no changed row`,
      ),
    ];
  });
}

function rowViolations(
  table: ComparedTable,
  pair: RowPair,
  rows: readonly CatalogueRow[],
  units: readonly CatalogueUnit[],
): string[] {
  const row = rows.find(
    (candidate) => candidate.pair.identity === pair.identity,
  );

  if (!row) {
    return [`${rowNameOf(pair)} has no catalogue row`];
  }

  const rowUnits = units.filter((unit) =>
    unit.rowIdentities.includes(pair.identity),
  );

  return new RowOwnership(table, row, rowUnits).violations();
}

function unitsOfNoChangedRow(
  units: readonly CatalogueUnit[],
  pairs: readonly RowPair[],
): CatalogueUnit[] {
  const identities = new Set(pairs.map((pair) => pair.identity));

  return units.filter(
    (unit) =>
      unit.rowIdentities.length > 0 &&
      !unit.rowIdentities.some((identity) => identities.has(identity)),
  );
}

class RowOwnership {
  private readonly name: string;

  constructor(
    private readonly table: ComparedTable,
    private readonly row: CatalogueRow,
    private readonly units: readonly CatalogueUnit[],
  ) {
    this.name = rowNameOf(row.pair);
  }

  public violations(): string[] {
    const { head, draft } = this.row.pair;

    if (head && draft) {
      return this.differenceViolations(this.differencesOf(head, draft));
    }

    return this.existenceViolations();
  }

  private existenceViolations(): string[] {
    const [owner, ...others] = this.units;

    if (
      !owner ||
      others.length > 0 ||
      !EXISTENCE_KINDS.includes(owner.unit.kind)
    ) {
      return [
        `${this.name} exists on one side only and is owned by [${this.units.map(describeUnit).join(', ')}]`,
      ];
    }

    if (this.row.existence !== owner.key) {
      return [
        `${this.name} records ${String(this.row.existence)} as the owner of its existence instead of ${describeUnit(owner)}`,
      ];
    }

    return [];
  }

  private differencesOf(head: Row, draft: Row): Difference[] {
    const columns = WHOLE_COLUMNS.filter(
      (column) => !WHOLE_COLUMN_EQUALITY[column](head, draft),
    );
    const leaves = this.leaves().filter(
      (leaf) =>
        !deepEqual(
          valueAt(head.data, leaf.pointer),
          valueAt(draft.data, leaf.pointer),
        ),
    );

    return [
      ...columns.map((column) => this.columnDifference(column)),
      ...leaves.map((leaf) => this.leafDifference(leaf)),
    ];
  }

  private differenceViolations(differences: readonly Difference[]): string[] {
    return [
      ...differences.flatMap((difference) => this.ownerViolations(difference)),
      ...this.unitsOwningNothing(differences).map(
        (unit) => `${this.name}: ${describeUnit(unit)} owns no difference`,
      ),
      ...this.ownersOfEqualColumns(differences).map(
        (column) =>
          `${this.name} records an owner of ${column}, which does not differ`,
      ),
    ];
  }

  private ownerViolations(difference: Difference): string[] {
    const { name, claimants, recordedOwner, followsInputs } = difference;
    const owners = claimants.map((claimant) => claimant.name).join(', ');

    if (followsInputs) {
      if (claimants.length > 0 || recordedOwner !== undefined) {
        return [
          `${this.name} ${name} follows its inputs but is owned by [${owners}]`,
        ];
      }

      return [];
    }

    const [claimant] = claimants;

    if (!claimant || claimants.length > 1) {
      return [`${this.name} ${name} is owned by [${owners}]`];
    }

    if (recordedOwner !== claimant.key) {
      return [
        `${this.name} ${name} records ${String(recordedOwner)} as its owner instead of ${claimant.name}`,
      ];
    }

    return [];
  }

  private unitsOwningNothing(
    differences: readonly Difference[],
  ): CatalogueUnit[] {
    const claimed = new Set(
      differences.flatMap(({ claimants }) => claimants.map(({ key }) => key)),
    );
    const differing = new Set(differences.map(({ name }) => name));

    return this.units.filter(
      ({ key, unit }) =>
        !claimed.has(key) ||
        (unit.columns ?? []).some((column) => !differing.has(column)),
    );
  }

  private ownersOfEqualColumns(differences: readonly Difference[]): string[] {
    const differing = new Set(differences.map(({ name }) => name));

    return [...this.row.columns.keys(), ...this.row.leaves.keys()].filter(
      (column) => !differing.has(column),
    );
  }

  private columnDifference(column: WholeColumn): Difference {
    return {
      name: column,
      claimants: [
        ...this.units
          .filter((unit) => this.coversColumn(unit, column))
          .map(claimantOf),
        ...this.structureClaimant(this.structureCoversColumn(column)),
      ],
      recordedOwner: this.row.columns.get(column),
      followsInputs: false,
    };
  }

  private leafDifference(leaf: Leaf): Difference {
    const path = leaf.pointer.toString();

    return {
      name: path,
      claimants: [
        ...this.units
          .filter(({ unit }) => unit.kind === 'field' && unit.path === path)
          .map(claimantOf),
        ...this.structureClaimant(leaf.changed),
      ],
      recordedOwner: this.row.leaves.get(path),
      followsInputs: leaf.followsInputs,
    };
  }

  private coversColumn({ unit }: CatalogueUnit, column: WholeColumn): boolean {
    if (unit.kind === 'rowRename') {
      return column === 'id';
    }

    if (unit.kind === 'field') {
      return column === 'publishedAt' && unit.path === this.publishedAtPath();
    }

    return (unit.columns ?? []).some((owned) => owned === column);
  }

  private structureCoversColumn(column: WholeColumn): boolean {
    const { structure } = this.table;

    if (column === 'publishedAt') {
      return structure.publishedAtOwner.owner === 'structure';
    }

    return column === 'schemaHash' && structure.differs;
  }

  private structureClaimant(covers: boolean): Claimant[] {
    if (!covers) {
      return [];
    }

    return [{ name: 'structure', key: structureUnitKey(this.table.identity) }];
  }

  private publishedAtPath(): string | undefined {
    return this.table.structure.unchangedLeaves
      .find((leaf) => leaf.kind === 'publishedAt')
      ?.pointer.toString();
  }

  private leaves(): Leaf[] {
    const { unchangedLeaves, changedPointers } = this.table.structure;

    return [
      ...unchangedLeaves
        .filter((leaf) => leaf.kind !== 'publishedAt')
        .map((leaf) => ({
          pointer: leaf.pointer,
          changed: false,
          followsInputs: leaf.kind === 'computed',
        })),
      ...changedPointers.map((pointer) => ({
        pointer,
        changed: true,
        followsInputs: false,
      })),
    ];
  }
}

function claimantOf(unit: CatalogueUnit): Claimant {
  return { name: describeUnit(unit), key: unit.key };
}

function describeUnit(unit: CatalogueUnit): string {
  return JSON.stringify(unit.unit);
}

function rowNameOf({ head, draft }: RowPair): string {
  return `row ${String((draft ?? head)?.id)}`;
}

function valueAt(data: unknown, pointer: JsonPointer): unknown {
  return pointer.segments.reduce<unknown>(
    (value, segment) => (isObject(value) ? value[segment] : undefined),
    data,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
