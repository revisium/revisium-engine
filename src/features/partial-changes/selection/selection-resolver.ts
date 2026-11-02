import {
  distinctBlockers,
  type PlanBlocker,
  refusalBlocker,
  requiredExcluded,
} from 'src/features/partial-changes/plan/plan-blocker';
import type { Reason } from 'src/features/partial-changes/plan/reason';
import {
  isWholeDraftSelection,
  type Selection,
} from 'src/features/partial-changes/selection/selection';
import type {
  SelectionResolution,
  SelectionSource,
  UnmatchedSelection,
} from 'src/features/partial-changes/selection/selection-resolution';
import { SelectionTargets } from 'src/features/partial-changes/selection/selection-targets';
import type { ItemsResolution } from 'src/features/partial-changes/selection/selector-match';
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
  private readonly included: ItemsResolution;
  private readonly exclusions: ItemsResolution;
  private readonly excluded: ReadonlySet<string>;

  constructor(
    private readonly selection: Selection,
    private readonly source: SelectionSource,
  ) {
    const matcher = new SelectorMatcher(
      new SelectionTargets(source),
      source.catalogue.lookup,
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
    const required = this.requiredAdditions(selected);

    return {
      selected,
      excluded: this.excluded,
      required,
      blockers: distinctBlockers([
        ...this.refusalsOfEveryTable(),
        ...this.included.blockers,
        ...this.exclusions.blockers,
        ...this.excludedRequiredUnits(),
        ...this.unmatchedSelectors(selected.size + required.size),
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
      .map(([key, reason]) =>
        requiredExcluded(this.source.catalogue.lookup.unit(key), reason),
      );
  }

  private unmatchedSelectors(appliedUnits: number): PlanBlocker[] {
    if (!this.anySelectorUnmatched() || appliedUnits === 0) {
      return [];
    }

    return [UNMATCHED_SELECTOR];
  }

  private anySelectorUnmatched(): boolean {
    return this.included.hasUnmatched || this.exclusions.hasUnmatched;
  }

  private unmatched(): UnmatchedSelection {
    const included = this.included.unmatchedItems();

    if (!this.exclusions.hasUnmatched) {
      return included;
    }

    return { ...included, exclude: this.exclusions.unmatchedItems() };
  }
}
