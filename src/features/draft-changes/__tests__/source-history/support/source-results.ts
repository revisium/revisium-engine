import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { traceSourceHistory } from 'src/features/draft-changes/schema/source-history/trace-source-history';
import type {
  SourceHistory,
  SourceHistoryBlocker,
  SourceHistoryBlockerCode,
  SourceHistoryResult,
  SourceTable,
} from 'src/features/draft-changes/schema/source-history/source-history.types';
import type { SourceBranch } from './source-branch';

export function trace(
  branch: SourceBranch,
  schemaRefs?: Record<string, JsonSchema>,
): SourceHistoryResult {
  return traceSourceHistory({
    snapshot: branch.snapshot(),
    ...(schemaRefs ? { schemaRefs } : {}),
  });
}

export function expectTraced(result: SourceHistoryResult): SourceHistory {
  expect(result).toMatchObject({ status: 'traced' });
  if (result.status !== 'traced') {
    throw new Error('Expected a traced source history.');
  }
  return result.history;
}

export function expectBlocked(
  result: SourceHistoryResult,
  code: SourceHistoryBlockerCode,
): SourceHistoryBlocker {
  expect(result).toMatchObject({ status: 'blocked', blocker: { code } });
  if (result.status !== 'blocked') {
    throw new Error('Expected a blocked source history.');
  }
  return result.blocker;
}

export function liveTable(history: SourceHistory, name: string): SourceTable {
  return requireTable(
    history,
    { draft: expect.objectContaining({ tableId: name }) },
    `live source table '${name}'`,
  );
}

export function headTable(history: SourceHistory, name: string): SourceTable {
  return requireTable(
    history,
    { head: expect.objectContaining({ tableId: name }) },
    `Head source table '${name}'`,
  );
}

export function pendingTable(
  history: SourceHistory,
  eventIndex: number,
): SourceTable {
  return requireTable(
    history,
    { identity: history.pendingEvents[eventIndex]?.tableIdentity },
    `source table of event ${eventIndex}`,
  );
}

function requireTable(
  history: SourceHistory,
  shape: Partial<Record<keyof SourceTable, unknown>>,
  label: string,
): SourceTable {
  expect(history.tables).toContainEqual(expect.objectContaining(shape));
  const table = history.tables.find((item) =>
    expect.objectContaining(shape).asymmetricMatch(item),
  );
  if (!table) {
    throw new Error(`Expected a ${label}.`);
  }
  return table;
}
