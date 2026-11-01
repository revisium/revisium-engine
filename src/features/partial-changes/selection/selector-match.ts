import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type {
  RefusalCode,
  RefusedTable,
} from 'src/features/partial-changes/head-schema/head-schema-check';
import type {
  ItemKind,
  ItemSelector,
  SelectionItems,
} from 'src/features/partial-changes/selection/selection';
import type {
  PlanBlocker,
  Reason,
} from 'src/features/partial-changes/selection/selection-resolution';

export interface RequiredAddition {
  readonly key: string;
  readonly reason: Reason;
}

export interface SelectorMatch {
  readonly selected: readonly string[];
  readonly required: readonly RequiredAddition[];
  readonly blockers: readonly PlanBlocker[];
}

export const NO_MATCH: SelectorMatch = {
  selected: [],
  required: [],
  blockers: [],
};

const REFUSAL_REASONS: Readonly<Record<RefusalCode, string>> = {
  headSchemaInconsistent: 'its Head schema does not match its Head ledger',
  unledgeredTable: 'it has no intact ledger lineage',
};

export function selecting(units: readonly CatalogueUnit[]): SelectorMatch {
  return { ...NO_MATCH, selected: units.map(({ key }) => key) };
}

export function selectingUnit(unit: CatalogueUnit | undefined): SelectorMatch {
  return selecting(unit ? [unit] : []);
}

export function requiringUnit(
  unit: CatalogueUnit | undefined,
  reason: Reason,
): SelectorMatch {
  if (!unit) {
    return NO_MATCH;
  }

  return { ...NO_MATCH, required: [{ key: unit.key, reason }] };
}

export function blockedBy(blockers: readonly PlanBlocker[]): SelectorMatch {
  return { ...NO_MATCH, blockers };
}

export function refusing(
  refusals: readonly RefusedTable[],
): SelectorMatch | undefined {
  if (refusals.length === 0) {
    return undefined;
  }

  return blockedBy(refusals.map(refusalBlocker));
}

export function refusalBlocker({ tableId, code }: RefusedTable): PlanBlocker {
  return {
    code,
    tableId,
    message: `${tableId} is refused: ${REFUSAL_REASONS[code]}`,
  };
}

export function combined(
  left: SelectorMatch,
  right: SelectorMatch,
): SelectorMatch {
  return {
    selected: [...left.selected, ...right.selected],
    required: [...left.required, ...right.required],
    blockers: [...left.blockers, ...right.blockers],
  };
}

export class ItemsResolution {
  public readonly selected = new Set<string>();
  public readonly required = new Map<string, Reason>();
  public readonly blockers: PlanBlocker[] = [];

  private readonly unmatched = new Map<ItemKind, unknown[]>();

  public get hasUnmatched(): boolean {
    return this.unmatched.size > 0;
  }

  public addEach<K extends ItemKind>(
    item: K,
    selectors: readonly ItemSelector<K>[] | undefined,
    match: (selector: ItemSelector<K>) => SelectorMatch,
  ): void {
    for (const selector of selectors ?? []) {
      this.add(item, selector, match(selector));
    }
  }

  public unmatchedItems(): SelectionItems {
    return Object.fromEntries(this.unmatched) as SelectionItems;
  }

  private add(item: ItemKind, selector: unknown, match: SelectorMatch): void {
    if (!isMatched(match)) {
      this.addUnmatched(item, selector);

      return;
    }

    match.selected.forEach((key) => this.selected.add(key));
    match.required.forEach(({ key, reason }) => this.addRequired(key, reason));
    this.blockers.push(...match.blockers);
  }

  private addRequired(key: string, reason: Reason): void {
    if (!this.required.has(key)) {
      this.required.set(key, reason);
    }
  }

  private addUnmatched(item: ItemKind, selector: unknown): void {
    const selectors = this.unmatched.get(item);

    if (selectors) {
      selectors.push(selector);
    } else {
      this.unmatched.set(item, [selector]);
    }
  }
}

function isMatched({ selected, required, blockers }: SelectorMatch): boolean {
  return selected.length > 0 || required.length > 0 || blockers.length > 0;
}
