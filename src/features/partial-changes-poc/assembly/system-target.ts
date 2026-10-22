import objectHash from 'object-hash';
import type { AssemblyInput } from 'src/features/partial-changes-poc/assembly/target-assembler.service';
import {
  TableOutcome,
  TargetRow,
  TargetTable,
  ViewsTarget,
} from 'src/features/partial-changes-poc/assembly/target.types';
import {
  CatalogueTable,
  catalogueRowOf,
  structureUnitOfOwner,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import {
  oppositeOf,
  RevisionSide,
  RowVersion,
  sideOf,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { columnsOf } from 'src/features/partial-changes-poc/catalogue/row-columns';
import { SystemTables } from 'src/features/share/system-tables.consts';

export interface SystemAssemblyInput extends AssemblyInput {
  takenFromDraft: (key: string) => boolean;
  userTables: TargetTable[];
  views: ViewsTarget[];
}

type Desired =
  | { kind: 'version'; version: RowVersion }
  | {
      kind: 'data';
      createdId: string;
      id: string;
      data: unknown;
      metaSource: RowVersion;
    };

interface SystemRowsOfTable {
  head: RowVersion[];
  draft: RowVersion[];
  desired: Desired[];
}

export function assembleSystemTables(
  input: SystemAssemblyInput,
): TargetTable[] {
  return [...input.catalogue.tables.values()]
    .filter((table) => table.kind === 'system')
    .map((table) => assembleSystemTable(table, input));
}

function assembleSystemTable(
  table: CatalogueTable,
  input: SystemAssemblyInput,
): TargetTable {
  const rows = desiredRows(table, input);
  const linkSide: RevisionSide = sideOf(table.pair, input.direction.base)
    ? input.direction.base
    : input.direction.other;

  if (!rows) {
    return { table, outcome: 'unchanged', linkSide, rows: [] };
  }

  const outcome = systemOutcome(table, rows, linkSide);
  return {
    table,
    outcome,
    linkSide,
    publicId: (table.pair.head ?? table.pair.draft)?.id,
    rows:
      outcome === 'mixed'
        ? mixedRows(rows.desired, sideOf(rows, linkSide) ?? [], linkSide)
        : [],
  };
}

function desiredRows(
  table: CatalogueTable,
  input: SystemAssemblyInput,
): SystemRowsOfTable | undefined {
  const { system } = input.snapshot;

  switch (table.tableId) {
    case SystemTables.Schema:
      return { ...system.schemas, desired: desiredSchemaRows(input) };
    case SystemTables.Migration:
      return { ...system.migrations, desired: desiredMigrationRows(input) };
    case SystemTables.Views:
      return { ...system.views, desired: desiredViewsRows(input) };
    case SystemTables.SharedSchemas:
      return desiredSharedRows(input);
    default:
      return undefined;
  }
}

function desiredSchemaRows(input: SystemAssemblyInput): Desired[] {
  return input.userTables.flatMap((target) => {
    if (target.outcome === 'absent' || !target.structureSide) {
      return [];
    }
    const rows = input.catalogue.schemaRows.get(target.table.pair.createdId);
    const version = rows ? sideOf(rows, target.structureSide) : undefined;
    return version ? [{ kind: 'version' as const, version }] : [];
  });
}

function desiredMigrationRows(input: SystemAssemblyInput): Desired[] {
  const { ledger } = input.catalogue;
  const pending = ledger.pending.filter((entry) => {
    const owner = ledger.attribution.ownerOf.get(entry.version.versionId);
    return input.takenFromDraft(structureUnitOfOwner(input.catalogue, owner));
  });

  return [...ledger.published, ...pending].map((entry) => ({
    kind: 'version' as const,
    version: entry.version,
  }));
}

function desiredViewsRows(input: SystemAssemblyInput): Desired[] {
  return input.views.flatMap((target): Desired[] => {
    const pair = input.catalogue.views.get(target.table.pair.createdId);
    if (!pair || !target.doc) {
      return [];
    }

    const existing = [pair.head, pair.draft].find(
      (version) =>
        version?.id === target.publicId &&
        objectHash(version.data as object) === objectHash(target.doc ?? {}),
    );
    if (existing) {
      return [{ kind: 'version' as const, version: existing }];
    }

    const source = pair.head ?? pair.draft;
    return source
      ? [
          {
            kind: 'data' as const,
            createdId: source.createdId,
            id: target.publicId,
            data: target.doc,
            metaSource: source,
          },
        ]
      : [];
  });
}

function desiredSharedRows(input: SystemAssemblyInput): SystemRowsOfTable {
  const changed = new Map(
    [...input.catalogue.sharedRows].map(([key, pair]) => [
      pair.createdId,
      { key, pair },
    ]),
  );
  const head = input.snapshot.system.shared.head;
  const draft = input.snapshot.system.shared.draft;
  const unchanged = [...head, ...draft].filter(
    (row) => !changed.has(row.createdId),
  );
  const decided = [...changed.values()].flatMap(({ key, pair }) => {
    const version = input.takenFromDraft(key) ? pair.draft : pair.head;
    return version ? [version] : [];
  });

  return {
    head,
    draft,
    desired: uniqueByVersion([...unchanged, ...decided]).map((version) => ({
      kind: 'version' as const,
      version,
    })),
  };
}

function uniqueByVersion(rows: RowVersion[]): RowVersion[] {
  return [...new Map(rows.map((row) => [row.versionId, row])).values()];
}

function systemOutcome(
  table: CatalogueTable,
  rows: SystemRowsOfTable,
  linkSide: RevisionSide,
): TableOutcome {
  const linked = sideOf(rows, linkSide) ?? [];
  const other = sideOf(rows, oppositeOf(linkSide)) ?? [];
  const hasNewRows = rows.desired.some((row) => row.kind === 'data');
  const desiredIds = new Set(
    rows.desired.flatMap((row) =>
      row.kind === 'version' ? [row.version.versionId] : [],
    ),
  );

  if (!sideOf(table.pair, linkSide) && desiredIds.size === 0 && !hasNewRows) {
    return 'absent';
  }

  if (!hasNewRows && sameVersions(desiredIds, linked)) {
    return sideOf(table.pair, linkSide) ? 'base' : 'absent';
  }

  if (
    !hasNewRows &&
    sameVersions(desiredIds, other) &&
    sideOf(table.pair, oppositeOf(linkSide))
  ) {
    return 'other';
  }

  return 'mixed';
}

function sameVersions(desired: Set<string>, rows: RowVersion[]): boolean {
  return (
    desired.size === rows.length &&
    rows.every((row) => desired.has(row.versionId))
  );
}

function mixedRows(
  desired: Desired[],
  linked: RowVersion[],
  linkSide: RevisionSide,
): TargetRow[] {
  const desiredIds = new Set(
    desired.flatMap((row) =>
      row.kind === 'version' ? [row.version.versionId] : [],
    ),
  );
  const linkedIds = new Set(linked.map((row) => row.versionId));

  const dropped: TargetRow[] = linked
    .filter((row) => !desiredIds.has(row.versionId))
    .map((row) => ({
      row: catalogueRowOf({ createdId: row.createdId, [linkSide]: row }),
      outcome: { kind: 'absent' },
    }));

  const added = desired.flatMap((row): TargetRow[] => {
    if (row.kind === 'data') {
      return [newSystemRow(row)];
    }
    if (linkedIds.has(row.version.versionId)) {
      return [];
    }
    return [
      {
        row: catalogueRowOf({ createdId: row.version.createdId }),
        outcome: { kind: 'other', version: row.version },
      },
    ];
  });

  return [...dropped, ...added];
}

function newSystemRow(row: Extract<Desired, { kind: 'data' }>): TargetRow {
  return {
    row: catalogueRowOf({ createdId: row.createdId }),
    outcome: {
      kind: 'merged',
      createdId: row.createdId,
      id: row.id,
      data: row.data as Record<string, unknown>,
      hash: objectHash(row.data as object),
      schemaHash: row.metaSource.schemaHash,
      columns: columnsOf(row.metaSource),
    },
  };
}
