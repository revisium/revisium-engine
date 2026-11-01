import {
  UNIT_KINDS,
  type Unit,
  type UnitKind,
} from 'src/features/partial-changes/catalogue/unit';

export class UnitKindCoverage {
  private readonly seen = new Set<UnitKind>();

  public record(units: readonly Pick<Unit, 'kind'>[]): void {
    for (const { kind } of units) {
      this.seen.add(kind);
    }
  }

  public missingKinds(): UnitKind[] {
    return UNIT_KINDS.filter((kind) => !this.seen.has(kind));
  }
}
