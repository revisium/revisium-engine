export interface ConnectedTable {
  readonly identity?: string;
  readonly tableIds: readonly string[];
  readonly referencedTableIds: readonly string[];
}

export class TableConnections {
  private readonly identitiesByTableId = new Map<string, string[]>();
  private readonly links = new Map<string, Set<string>>();

  constructor(tables: readonly ConnectedTable[]) {
    for (const { identity, tableIds, referencedTableIds } of tables) {
      if (identity !== undefined) {
        this.name(identity, tableIds);
      }

      this.link([...tableIds, ...referencedTableIds]);
    }
  }

  public connectedTo(tableIds: readonly string[]): ReadonlySet<string> {
    const connected = new Set<string>();
    const pending = [...tableIds];

    for (
      let tableId = pending.pop();
      tableId !== undefined;
      tableId = pending.pop()
    ) {
      if (!connected.has(tableId)) {
        connected.add(tableId);
        pending.push(...(this.links.get(tableId) ?? []));
      }
    }

    return new Set(
      [...connected].flatMap((tableId) => this.identitiesNamed(tableId)),
    );
  }

  private name(identity: string, tableIds: readonly string[]): void {
    for (const tableId of new Set(tableIds)) {
      this.identitiesByTableId.set(tableId, [
        ...this.identitiesNamed(tableId),
        identity,
      ]);
    }
  }

  private link(tableIds: readonly string[]): void {
    const [first, ...others] = tableIds;

    if (first === undefined) {
      return;
    }

    for (const other of others) {
      this.addLink(first, other);
      this.addLink(other, first);
    }
  }

  private addLink(from: string, to: string): void {
    const links = this.links.get(from);

    if (links) {
      links.add(to);
      return;
    }

    this.links.set(from, new Set([to]));
  }

  private identitiesNamed(tableId: string): readonly string[] {
    return this.identitiesByTableId.get(tableId) ?? [];
  }
}
