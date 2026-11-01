import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { Unit } from 'src/features/partial-changes/catalogue/unit';
import { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import {
  isWholeDraftSelection,
  type Selection,
} from 'src/features/partial-changes/selection/selection';
import type {
  PlanBlocker,
  Reason,
  SelectionResolution,
  SelectionSource,
  UnmatchedSelection,
} from 'src/features/partial-changes/selection/selection-resolution';
import { SelectionTargets } from 'src/features/partial-changes/selection/selection-targets';
import {
  type ItemsResolution,
  refusalBlocker,
} from 'src/features/partial-changes/selection/selector-match';
import { SelectorMatcher } from 'src/features/partial-changes/selection/selector-matcher';

const UNMATCHED_SELECTOR: PlanBlocker = {
  code: 'unmatchedSelector',
  message: 'Some selectors match no unit; see unmatched',
};

export function resolveSelection(
  selection: Selection,
  source: SelectionSource,
): SelectionResolution {
  return new SelectionResolver(selection, source).resolve();
}

class SelectionResolver {
  private readonly lookup: CatalogueLookup;
  private readonly included: ItemsResolution;
  private readonly exclusions: ItemsResolution;
  private readonly excluded: ReadonlySet<string>;

  constructor(
    private readonly selection: Selection,
    private readonly source: SelectionSource,
  ) {
    this.lookup = new CatalogueLookup(source.catalogue);

    const matcher = new SelectorMatcher(
      new SelectionTargets(source),
      this.lookup,
    );

    this.included = matcher.matchItems(selection);
    this.exclusions = matcher.matchItems(selection.exclude ?? {});
    this.excluded = new Set([
      ...this.exclusions.selected,
      ...this.exclusions.required.keys(),
    ]);
  }

  public resolve(): SelectionResolution {
    const selected = this.selectedKeys();

    return {
      selected,
      excluded: this.excluded,
      required: this.requiredAdditions(selected),
      blockers: distinctBlockers([
        ...this.refusalsOfEveryTable(),
        ...this.included.blockers,
        ...this.exclusions.blockers,
        ...this.excludedRequiredUnits(),
        ...this.unmatchedSelectors(),
      ]),
      unmatched: this.unmatched(),
    };
  }

  private selectedKeys(): Set<string> {
    return new Set(
      this.candidateKeys().filter((key) => !this.excluded.has(key)),
    );
  }

  private candidateKeys(): string[] {
    if (this.selection.all) {
      return this.source.catalogue.units.map(({ key }) => key);
    }

    return [...this.included.selected];
  }

  private requiredAdditions(
    selected: ReadonlySet<string>,
  ): Map<string, Reason> {
    return new Map(
      [...this.included.required].filter(
        ([key]) => !selected.has(key) && !this.excluded.has(key),
      ),
    );
  }

  private refusalsOfEveryTable(): PlanBlocker[] {
    if (!this.selection.all || isWholeDraftSelection(this.selection)) {
      return [];
    }

    return this.source.catalogue.refusedTables.map(refusalBlocker);
  }

  private excludedRequiredUnits(): PlanBlocker[] {
    return [...this.included.required]
      .filter(([key]) => this.excluded.has(key))
      .map(([key, reason]) => requiredExcluded(this.lookup.unit(key), reason));
  }

  private unmatchedSelectors(): PlanBlocker[] {
    if (!this.anySelectorUnmatched() || !this.anySelectorMatched()) {
      return [];
    }

    return [UNMATCHED_SELECTOR];
  }

  private anySelectorUnmatched(): boolean {
    return this.included.hasUnmatched || this.exclusions.hasUnmatched;
  }

  private anySelectorMatched(): boolean {
    const allMatched =
      this.selection.all === true && this.source.catalogue.units.length > 0;

    return allMatched || this.included.hasMatched || this.exclusions.hasMatched;
  }

  private unmatched(): UnmatchedSelection {
    const included = this.included.unmatchedItems();

    if (!this.exclusions.hasUnmatched) {
      return included;
    }

    return { ...included, exclude: this.exclusions.unmatchedItems() };
  }
}

function requiredExcluded(
  { key, unit }: CatalogueUnit,
  reason: Reason,
): PlanBlocker {
  const { tableId, rowId, path } = unit;

  return {
    code: 'requiredExcluded',
    tableId,
    rowId,
    path,
    message: `${addressOf(unit)} is required but excluded`,
    unitKey: key,
    reason,
  };
}

function addressOf({ tableId, rowId, path }: Unit): string {
  if (rowId === undefined) {
    return tableId;
  }

  return `${tableId}/${rowId}${path ?? ''}`;
}

function distinctBlockers(blockers: readonly PlanBlocker[]): PlanBlocker[] {
  const distinct = new Map<string, PlanBlocker>();

  for (const blocker of blockers) {
    const { code, tableId, rowId, path } = blocker;
    const key = JSON.stringify([code, tableId, rowId, path]);

    if (!distinct.has(key)) {
      distinct.set(key, blocker);
    }
  }

  return [...distinct.values()];
}
