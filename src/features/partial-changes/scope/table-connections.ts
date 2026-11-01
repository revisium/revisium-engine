import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { publicIdsOf } from 'src/features/partial-changes/catalogue/public-id-groups';
import type {
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';

export type ForeignKeysOf = (schema: JsonSchema) => string[];

export class TableConnections {
  private readonly identitiesByPublicId: ReadonlyMap<string, readonly string[]>;
  private readonly links = new Map<string, Set<string>>();

  constructor(tables: readonly TablePair[], foreignKeysOf: ForeignKeysOf) {
    this.identitiesByPublicId = identitiesByPublicIdOf(tables);

    for (const table of tables) {
      for (const tableId of linkedTableIdsOf(table, foreignKeysOf)) {
        this.link(table.identity, this.identitiesNamed(tableId));
      }
    }
  }

  public connectedTo(tableIds: readonly string[]): ReadonlySet<string> {
    const connected = new Set<string>();
    const pending = tableIds.flatMap((tableId) =>
      this.identitiesNamed(tableId),
    );

    for (
      let identity = pending.pop();
      identity !== undefined;
      identity = pending.pop()
    ) {
      if (!connected.has(identity)) {
        connected.add(identity);
        pending.push(...(this.links.get(identity) ?? []));
      }
    }

    return connected;
  }

  private link(identity: string, others: readonly string[]): void {
    for (const other of others) {
      this.addLink(identity, other);
      this.addLink(other, identity);
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
    return this.identitiesByPublicId.get(tableId) ?? [];
  }
}

function identitiesByPublicIdOf(
  tables: readonly TablePair[],
): Map<string, string[]> {
  const identities = new Map<string, string[]>();

  for (const table of tables) {
    for (const publicId of publicIdsOf(table)) {
      identities.set(publicId, [
        ...(identities.get(publicId) ?? []),
        table.identity,
      ]);
    }
  }

  return identities;
}

function linkedTableIdsOf(
  table: TablePair,
  foreignKeysOf: ForeignKeysOf,
): string[] {
  const referencedTableIds = versionsOf(table).flatMap(({ schema }) =>
    foreignKeysOf(schema),
  );

  return [...publicIdsOf(table), ...referencedTableIds];
}

function versionsOf({ head, draft }: TablePair): TableVersion[] {
  return [head, draft].filter(
    (version): version is TableVersion => version !== undefined,
  );
}
