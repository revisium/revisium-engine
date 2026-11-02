import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import type { BranchScenario } from 'src/__tests__/fixtures/branch-scenario';
import { replayOf } from 'src/__tests__/fixtures/ledger-steps';
import { storedLedgerOf } from 'src/__tests__/fixtures/stored-ledger';
import type { BranchScenarioTestKit } from 'src/__tests__/kit/create-branch-scenario-test-kit';
import { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import type { RevisionSide } from './snapshot-reading';

export type ReplayedSchemas = Record<
  string,
  JsonSchema | { readonly unreplayable: string }
>;

export async function replayedSchemasOf(
  draft: BranchScenario,
  side: RevisionSide,
): Promise<ReplayedSchemas> {
  const { schemas, unreplayable } = replayOf(
    ...(await storedLedgerOf(draft, side)),
  );

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

export type SourceLedgers = Record<RevisionSide, Migration[]>;

export async function sourceLedgersOf(
  draft: BranchScenario,
): Promise<SourceLedgers> {
  return {
    head: await storedLedgerOf(draft, 'head'),
    draft: await storedLedgerOf(draft, 'draft'),
  };
}

export async function sourceReplaysDuring(
  kit: BranchScenarioTestKit,
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
  kit: BranchScenarioTestKit,
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
