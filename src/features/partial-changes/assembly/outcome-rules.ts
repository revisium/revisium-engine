import {
  oppositeOf,
  type RevisionSide,
} from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { CatalogueRow } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type {
  RowPair,
  TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';

export type ChangeOperation = 'commit' | 'revert';

export interface AppliedUnits {
  readonly operation: ChangeOperation;
  readonly applied: ReadonlySet<string>;
  readonly wholeDraft: boolean;
}

export type OtherSideColumn = 'publishedAt' | 'meta';

export interface OtherSideParts {
  readonly id: boolean;
  readonly paths: readonly string[];
  readonly columns: readonly OtherSideColumn[];
}

export type RowOutcome =
  | { readonly kind: 'absent' }
  | { readonly kind: 'structureSide' }
  | { readonly kind: 'otherSide' }
  | { readonly kind: 'move' }
  | { readonly kind: 'merge'; readonly fromOtherSide: OtherSideParts };

export type RowOutcomeKind = RowOutcome['kind'];

export interface RowWithOutcome {
  readonly pair: RowPair;
  readonly kind: RowOutcomeKind;
}

export type TableOutcome =
  | 'unchanged'
  | 'base'
  | 'other'
  | 'mixed'
  | 'present'
  | 'absent';

export interface TableUnits {
  readonly structure?: string;
  readonly rows: readonly string[];
}

export interface OutcomeTable {
  readonly units: TableUnits;
  readonly structureDiffers: boolean;
}

const ABSENT: RowOutcome = { kind: 'absent' };
const STRUCTURE_SIDE: RowOutcome = { kind: 'structureSide' };
const OTHER_SIDE: RowOutcome = { kind: 'otherSide' };
const MOVE: RowOutcome = { kind: 'move' };
const OTHER_SIDE_COLUMNS: readonly OtherSideColumn[] = ['publishedAt', 'meta'];
const BASE_SIDES: Readonly<Record<ChangeOperation, RevisionSide>> = {
  commit: 'head',
  revert: 'draft',
};

export class OutcomeRules {
  public readonly baseSide: RevisionSide;

  constructor(private readonly choice: AppliedUnits) {
    this.baseSide = BASE_SIDES[choice.operation];
  }

  public forTable(table: OutcomeTable): TableOutcomeRules {
    return new TableOutcomeRules(this, table);
  }

  public get operation(): ChangeOperation {
    return this.choice.operation;
  }

  public get appliesWholeDraft(): boolean {
    return this.choice.wholeDraft;
  }

  public get unitlessSide(): RevisionSide {
    if (this.choice.wholeDraft) {
      return oppositeOf(this.baseSide);
    }

    return this.baseSide;
  }

  public takesEveryTableOf(side: RevisionSide): boolean {
    return this.choice.wholeDraft && side === this.unitlessSide;
  }

  public isApplied(key: string): boolean {
    return this.choice.applied.has(key);
  }

  public isTakenFromDraft(key: string): boolean {
    return this.isApplied(key) === (this.baseSide === 'head');
  }

  public sideTakenBy(key: string): RevisionSide {
    if (this.isTakenFromDraft(key)) {
      return 'draft';
    }

    return 'head';
  }

  public structureSideOf(structure: string | undefined): RevisionSide {
    if (structure === undefined) {
      return this.baseSide;
    }

    return this.sideTakenBy(structure);
  }
}

export class TableOutcomeRules {
  public readonly structureSide: RevisionSide;
  public readonly otherSide: RevisionSide;

  constructor(
    private readonly rules: OutcomeRules,
    private readonly table: OutcomeTable,
  ) {
    this.structureSide = rules.structureSideOf(table.units.structure);
    this.otherSide = oppositeOf(this.structureSide);
  }

  public rowOutcomeOf(row: CatalogueRow): RowOutcome {
    const { pair, existence } = row;

    if (existence !== undefined && this.takesOtherSide(existence)) {
      return this.otherSideExistenceOf(pair);
    }

    if (!pair[this.structureSide]) {
      return ABSENT;
    }

    if (!pair[this.otherSide]) {
      return STRUCTURE_SIDE;
    }

    return this.outcomeOfDifferences(row);
  }

  public tableOutcomeOf(rows: readonly RowWithOutcome[]): TableOutcome {
    if (this.unitKeys().length === 0) {
      return this.outcomeWithoutUnits();
    }

    if (rows.every((row) => this.keepsStructureSideLink(row))) {
      return 'base';
    }

    if (this.takesOtherSideVersion(rows)) {
      return 'other';
    }

    return 'mixed';
  }

  public isRelinkCandidate(): boolean {
    return this.unitKeys().every((key) => this.rules.isApplied(key));
  }

  public outcomeOfOneSidedTable(pair: TablePair): TableOutcome {
    if (pair[this.structureSide]) {
      return 'present';
    }

    return 'absent';
  }

  private outcomeWithoutUnits(): TableOutcome {
    if (this.rules.appliesWholeDraft) {
      return 'other';
    }

    return 'unchanged';
  }

  private otherSideExistenceOf(pair: RowPair): RowOutcome {
    if (!pair[this.otherSide]) {
      return ABSENT;
    }

    if (this.table.structureDiffers) {
      return MOVE;
    }

    return OTHER_SIDE;
  }

  private outcomeOfDifferences(row: CatalogueRow): RowOutcome {
    const owners = new Set([...row.columns.values(), ...row.leaves.values()]);
    const taking = [...owners].filter((key) => this.takesOtherSide(key));

    if (taking.length === 0) {
      return STRUCTURE_SIDE;
    }

    if (taking.length === owners.size && !this.table.structureDiffers) {
      return OTHER_SIDE;
    }

    return { kind: 'merge', fromOtherSide: this.partsFromOtherSide(row) };
  }

  private partsFromOtherSide({
    columns,
    leaves,
  }: CatalogueRow): OtherSideParts {
    return {
      id: this.takesOwnerOtherSide(columns.get('id')),
      paths: [...leaves]
        .filter(([, owner]) => this.takesOtherSide(owner))
        .map(([path]) => path),
      columns: OTHER_SIDE_COLUMNS.filter((column) =>
        this.takesOwnerOtherSide(columns.get(column)),
      ),
    };
  }

  private takesOwnerOtherSide(owner: string | undefined): boolean {
    return owner !== undefined && this.takesOtherSide(owner);
  }

  private keepsStructureSideLink({ pair, kind }: RowWithOutcome): boolean {
    return (
      kind === 'structureSide' ||
      (kind === 'absent' && !pair[this.structureSide])
    );
  }

  private takesOtherSideVersion(rows: readonly RowWithOutcome[]): boolean {
    return (
      this.table.units.structure === undefined &&
      this.table.units.rows.every((key) => this.takesOtherSide(key)) &&
      rows.every(({ kind }) => kind === 'otherSide' || kind === 'absent')
    );
  }

  private takesOtherSide(key: string): boolean {
    return (
      this.rules.isTakenFromDraft(key) !== (this.structureSide === 'draft')
    );
  }

  private unitKeys(): string[] {
    const { structure, rows } = this.table.units;

    if (structure === undefined) {
      return [...rows];
    }

    return [structure, ...rows];
  }
}
