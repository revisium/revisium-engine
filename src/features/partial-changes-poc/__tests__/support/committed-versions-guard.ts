import {
  CommittedVersions,
  readCommittedVersions,
} from 'src/features/partial-changes-poc/__tests__/support/committed-versions';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

const REPORTED_VIOLATIONS = 20;

export class CommittedVersionsGuard {
  private readonly branchIds = new Set<string>();
  private observed: CommittedVersions = emptyObservation();

  constructor(private readonly prisma: PrismaService) {}

  track(branchId: string): void {
    this.branchIds.add(branchId);
  }

  async verify(): Promise<void> {
    const violations: string[] = [];

    for (const branchId of this.branchIds) {
      const current = await readCommittedVersions(this.prisma, branchId);
      violations.push(
        ...mutableVersions(current),
        ...duplicateRowIds(current),
        ...changedVersions(this.observed, current),
      );
      this.remember(current);
    }

    expect(violations.slice(0, REPORTED_VIOLATIONS)).toEqual([]);
  }

  acceptKnownNativeMutation(): void {
    this.observed = emptyObservation();
  }

  async verifyAndForget(): Promise<void> {
    try {
      await this.verify();
    } finally {
      this.branchIds.clear();
      this.observed = emptyObservation();
    }
  }

  private remember(current: CommittedVersions): void {
    keepFirst(this.observed.revisionTables, current.revisionTables);
    keepFirst(this.observed.tableRows, current.tableRows);
    keepFirst(this.observed.tables, current.tables);
    keepFirst(this.observed.rows, current.rows);
  }
}

export function guardCommittedVersions(
  guard: () => CommittedVersionsGuard,
): void {
  afterEach(async () => {
    await guard().verifyAndForget();
  });
}

function mutableVersions(current: CommittedVersions): string[] {
  const tables = Object.entries(current.tables)
    .filter(([, table]) => !(table as { readonly: boolean }).readonly)
    .map(
      ([versionId, table]) =>
        `table ${idOf(table)} ${versionId} is linked by a committed revision but mutable`,
    );
  const rows = Object.entries(current.rows)
    .filter(([, row]) => !(row as { readonly: boolean }).readonly)
    .map(
      ([versionId, row]) =>
        `row ${idOf(row)} ${versionId} is linked by a committed revision but mutable`,
    );
  return [...tables, ...rows];
}

function duplicateRowIds(current: CommittedVersions): string[] {
  return Object.entries(current.tableRows).flatMap(
    ([tableVersionId, rowVersionIds]) => {
      const ids = rowVersionIds.map((versionId) =>
        idOf(current.rows[versionId]),
      );
      return [
        ...new Set(ids.filter((id, index) => ids.indexOf(id) !== index)),
      ].map(
        (id) =>
          `committed table version ${tableVersionId} holds two rows with id ${id}`,
      );
    },
  );
}

function changedVersions(
  observed: CommittedVersions,
  current: CommittedVersions,
): string[] {
  return [
    ...changedEntries(
      observed.revisionTables,
      current.revisionTables,
      'table links of committed revision',
    ),
    ...changedEntries(
      observed.tableRows,
      current.tableRows,
      'row links of committed table version',
    ),
    ...changedEntries(
      observed.tables,
      current.tables,
      'committed table version',
    ),
    ...changedEntries(observed.rows, current.rows, 'committed row version'),
  ];
}

function changedEntries(
  observed: Record<string, unknown>,
  current: Record<string, unknown>,
  label: string,
): string[] {
  return Object.entries(current)
    .filter(
      ([key, value]) =>
        key in observed && canonical(observed[key]) !== canonical(value),
    )
    .map(
      ([key, value]) =>
        `${label} ${key} changed: ${canonical(observed[key])} -> ${canonical(value)}`,
    );
}

function keepFirst(
  observed: Record<string, unknown>,
  current: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(current)) {
    if (!(key in observed)) {
      observed[key] = value;
    }
  }
}

function idOf(version: unknown): string {
  return (version as { id?: string }).id ?? '?';
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}

function emptyObservation(): CommittedVersions {
  return { revisionTables: {}, tableRows: {}, tables: {}, rows: {} };
}
