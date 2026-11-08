import type { TestingModule } from '@nestjs/testing';
import { FindRowsInTableHandler } from 'src/features/share/queries/handlers/transactional/find-rows-in-table.handler';
import { FindTableInRevisionHandler } from 'src/features/share/queries/handlers/transactional/find-table-in-revision.handler';

interface LookupKit {
  module: TestingModule;
}

interface LookupHandler<Query> {
  execute(query: Query): Promise<unknown>;
}

export interface FailingLookup {
  lookups(): number;
}

export function failTableLookupOnceWith(
  kit: LookupKit,
  tableId: string,
  failure: Error,
): FailingLookup {
  return failFirstLookupWith(
    kit.module.get(FindTableInRevisionHandler),
    (query) => query.data.tableId === tableId,
    failure,
  );
}

export function failViewsRowLookupOnceWith(
  kit: LookupKit,
  tableId: string,
  failure: Error,
): FailingLookup {
  return failFirstLookupWith(
    kit.module.get(FindRowsInTableHandler),
    (query) => query.data.rowIds.includes(tableId),
    failure,
  );
}

function failFirstLookupWith<Query>(
  handler: LookupHandler<Query>,
  isFailingLookup: (query: Query) => boolean,
  failure: Error,
): FailingLookup {
  const lookUp = handler.execute.bind(handler);
  let lookups = 0;

  jest.spyOn(handler, 'execute').mockImplementation(async (query: Query) => {
    if (!isFailingLookup(query)) {
      return lookUp(query);
    }

    lookups += 1;

    if (lookups === 1) {
      throw failure;
    }

    return lookUp(query);
  });

  return { lookups: () => lookups };
}
