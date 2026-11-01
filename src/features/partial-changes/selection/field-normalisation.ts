import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import {
  isCreatedOrRemoved,
  requireStructureOfCreatedOrRemoved,
} from 'src/features/partial-changes/selection/created-or-removed-tables';
import type { FieldRef } from 'src/features/partial-changes/selection/selection';
import type {
  PlanBlocker,
  Reason,
  RequiredReasonCode,
} from 'src/features/partial-changes/selection/selection-resolution';
import type {
  AddressedRow,
  SelectionTargets,
} from 'src/features/partial-changes/selection/selection-targets';
import {
  blocking,
  combined,
  NO_MATCH,
  requiring,
  type SelectorMatch,
  selecting,
} from 'src/features/partial-changes/selection/selector-match';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import type { SchemaLeaf } from 'src/features/partial-changes/structure/schema-leaves';

export class FieldNormalisation {
  private readonly path: JsonPointer;
  private readonly leaf: SchemaLeaf | undefined;
  private readonly address: string;

  constructor(
    private readonly targets: SelectionTargets,
    private readonly units: CatalogueLookup,
    private readonly row: AddressedRow,
    private readonly selector: FieldRef,
  ) {
    this.path = JsonPointer.parse(selector.path);
    this.leaf = targets.leafAtOrAbove(row, this.path);
    this.address = `${selector.tableId}/${selector.rowId}`;
  }

  public match(): SelectorMatch {
    if (this.leaf?.kind === 'computed') {
      return blocking([this.notSelectable()]);
    }

    if (isCreatedOrRemoved(this.row.table)) {
      return requireStructureOfCreatedOrRemoved(
        this.targets,
        this.units,
        this.row.table,
        this.selector,
      );
    }

    return combined(
      this.matchUnitsOfRow(),
      this.requireStructureOfChangedFields(),
    );
  }

  private matchUnitsOfRow(): SelectorMatch {
    const units = this.units.unitsOfRow(this.row);
    const existence = units.find(isExistence);

    if (existence) {
      return this.requireExistence(existence);
    }

    const fields = units.filter(({ unit }) => unit.kind === 'field');

    if (this.leaf && this.pointsInside(this.leaf)) {
      return this.requireAtomicValue(this.leaf, fields);
    }

    return selecting(
      fields.filter((field) => this.path.isAtOrAbove(pointerOf(field))),
    );
  }

  private pointsInside(leaf: SchemaLeaf): boolean {
    return !this.path.isAtOrAbove(leaf.pointer);
  }

  private requireExistence(existence: CatalogueUnit): SelectorMatch {
    return requiring(
      existence,
      this.reason(
        'wholeRowUnit',
        `${this.address} is created, deleted or replaced as a whole row`,
      ),
    );
  }

  private requireAtomicValue(
    leaf: SchemaLeaf,
    fields: readonly CatalogueUnit[],
  ): SelectorMatch {
    if (leaf.kind !== 'atomic') {
      return NO_MATCH;
    }

    const value = leaf.pointer.toString();

    return requiring(
      fields.find(({ unit }) => unit.path === value),
      this.reason(
        'atomicValue',
        `${this.selector.path} is inside the atomic value ${value} of ${this.address}`,
      ),
    );
  }

  private requireStructureOfChangedFields(): SelectorMatch {
    const touchesChangedField = this.targets
      .structureOf(this.row.table)
      .changedPointers.some(
        (pointer) =>
          pointer.isAtOrAbove(this.path) || this.path.isAtOrAbove(pointer),
      );

    if (!touchesChangedField) {
      return NO_MATCH;
    }

    return requiring(
      this.units.tableUnitOf('structure', this.row.table),
      this.reason(
        'structureBoundData',
        `${this.address}${this.selector.path} touches a new or changed field; its values belong to the structure of ${this.selector.tableId}`,
      ),
    );
  }

  private notSelectable(): PlanBlocker {
    const { tableId, rowId, path } = this.selector;

    return {
      code: 'notSelectable',
      tableId,
      rowId,
      path,
      message: `${this.address}${path} is a computed value that follows its inputs`,
    };
  }

  private reason(code: RequiredReasonCode, because: string): Reason {
    const { tableId, rowId, path } = this.selector;

    return { code, tableId, rowId, path, because };
  }
}

function isExistence({ unit }: CatalogueUnit): boolean {
  return (
    unit.kind === 'rowCreate' ||
    unit.kind === 'rowDelete' ||
    unit.kind === 'rowReplace'
  );
}

function pointerOf({ unit }: CatalogueUnit): JsonPointer {
  return JsonPointer.parse(unit.path ?? '');
}
