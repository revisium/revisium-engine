import type { Migration } from '@revisium/schema-toolkit/types';
import type { AssemblyInput } from 'src/features/partial-changes-poc/assembly/target-assembler.service';
import { takenFromDraft } from 'src/features/partial-changes-poc/assembly/outcome-plan';
import { structureUnitOfOwner } from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import type { RowVersion } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import {
  compareIds,
  LedgerEntry,
} from 'src/features/partial-changes-poc/structure/ledger';
import { nextNativeMigrationId } from 'src/features/draft/commands/handlers/migration/native-migration-id';

export interface RenumberedMigration {
  source: RowVersion;
  migration: Migration;
}

export interface LedgerPlan {
  target: LedgerEntry[];
  remaining: LedgerEntry[];
  renumbered: RenumberedMigration[];
}

export function planLedger(
  input: Pick<AssemblyInput, 'catalogue' | 'operation' | 'applied'>,
): LedgerPlan {
  const { ledger } = input.catalogue;
  const kept: LedgerEntry[] = [];
  const remaining: LedgerEntry[] = [];

  for (const entry of ledger.pending) {
    const owner = ledger.attribution.ownerOf.get(entry.version.versionId);
    const unit = structureUnitOfOwner(input.catalogue, owner);
    if (takenFromDraft(input, unit)) {
      kept.push(entry);
    } else {
      remaining.push(entry);
    }
  }

  const target = [...ledger.published, ...kept].sort((a, b) =>
    compareIds(a.migration.id, b.migration.id),
  );
  return {
    target,
    remaining,
    renumbered: input.operation === 'commit' ? renumber(target, remaining) : [],
  };
}

export function remainingLedger(plan: LedgerPlan): Migration[] {
  const renumbered = new Map(
    plan.renumbered.map((item) => [item.source.versionId, item.migration]),
  );
  return [
    ...plan.target.map((entry) => entry.migration),
    ...plan.remaining.map(
      (entry) => renumbered.get(entry.version.versionId) ?? entry.migration,
    ),
  ];
}

function renumber(
  published: LedgerEntry[],
  remaining: LedgerEntry[],
): RenumberedMigration[] {
  const last = published.at(-1);
  if (
    !last ||
    remaining.every(
      (entry) => compareIds(entry.migration.id, last.migration.id) > 0,
    )
  ) {
    return [];
  }

  let bounds = {
    id: last.migration.id,
    publishedAt: latestPublishedAt(published),
  };
  return remaining.map((entry) => {
    const id = nextNativeMigrationId(bounds);
    bounds = { id, publishedAt: new Date(id) };
    return { source: entry.version, migration: { ...entry.migration, id } };
  });
}

function latestPublishedAt(entries: LedgerEntry[]): Date | null {
  return entries.reduce<Date | null>((latest, entry) => {
    const publishedAt = new Date(entry.version.publishedAt);
    return !latest || publishedAt > latest ? publishedAt : latest;
  }, null);
}
