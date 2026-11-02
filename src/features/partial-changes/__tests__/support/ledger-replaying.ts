import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { replayOf } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import type { ChangesScenario } from './changes-scenario';
import type { RevisionSide } from './snapshot-reading';

export type ReplayedSchemas = Record<
  string,
  JsonSchema | { readonly unreplayable: string }
>;

export async function ledgerOf(
  draft: ChangesScenario,
  side: RevisionSide,
): Promise<Migration[]> {
  const snapshot = await draft.readSnapshot();

  return snapshot.systemRows.migrations[side]
    .map(({ data }) => data as unknown as Migration)
    .sort((left, right) => compareCodePoints(left.id, right.id));
}

export async function replayedSchemasOf(
  draft: ChangesScenario,
  side: RevisionSide,
): Promise<ReplayedSchemas> {
  const { schemas, unreplayable } = replayOf(...(await ledgerOf(draft, side)));

  return {
    ...Object.fromEntries(schemas),
    ...Object.fromEntries(
      [...unreplayable].map(([tableId, { error }]) => [
        tableId,
        { unreplayable: error },
      ]),
    ),
  };
}

export async function schemasOf(
  draft: ChangesScenario,
  side: RevisionSide,
): Promise<Record<string, JsonSchema>> {
  const snapshot = await draft.readSnapshot();

  return Object.fromEntries(
    snapshot.systemRows.schemas[side].map(({ id, data }) => [
      id,
      data as unknown as JsonSchema,
    ]),
  );
}

export type SourceLedgers = Record<RevisionSide, Migration[]>;

export async function sourceLedgersOf(
  draft: ChangesScenario,
): Promise<SourceLedgers> {
  return {
    head: await ledgerOf(draft, 'head'),
    draft: await ledgerOf(draft, 'draft'),
  };
}

export async function sourceReplaysDuring(
  kit: PartialChangesTestKit,
  sourceLedgers: SourceLedgers,
  action: () => Promise<unknown>,
): Promise<Record<RevisionSide, number>> {
  const replayed = await replayedLedgersDuring(kit, action);

  return {
    head: timesReplayed(replayed, sourceLedgers.head),
    draft: timesReplayed(replayed, sourceLedgers.draft),
  };
}

async function replayedLedgersDuring(
  kit: PartialChangesTestKit,
  action: () => Promise<unknown>,
): Promise<Migration[][]> {
  const replay = jest.spyOn(kit.module.get(LedgerReplayer), 'replay');

  try {
    await action();

    return replay.mock.calls.map(([ledger]) => [...ledger]);
  } finally {
    replay.mockRestore();
  }
}

function timesReplayed(
  replayed: readonly (readonly Migration[])[],
  ledger: readonly Migration[],
): number {
  return replayed.filter((replayedLedger) => deepEqual(replayedLedger, ledger))
    .length;
}
