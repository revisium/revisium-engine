import { Client } from 'pg';

export interface SqlStatement {
  readonly text: string;
  readonly values: readonly unknown[];
}

interface QueryConfig {
  readonly text: string;
  readonly values?: readonly unknown[];
}

export async function countSqlStatements(
  action: () => Promise<unknown>,
): Promise<number> {
  const statements = await sqlStatementsDuring(action);

  return statements.length;
}

export async function sqlStatementsDuring(
  action: () => Promise<unknown>,
): Promise<SqlStatement[]> {
  const query = jest.spyOn(Client.prototype, 'query');

  try {
    await action();

    return query.mock.calls.map(statementOf);
  } finally {
    query.mockRestore();
  }
}

function statementOf([query, values]: unknown[]): SqlStatement {
  if (typeof query === 'string') {
    return { text: query, values: Array.isArray(values) ? values : [] };
  }

  const config = query as QueryConfig;

  return { text: config.text, values: config.values ?? [] };
}
