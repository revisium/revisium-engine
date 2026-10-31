import { Client } from 'pg';

export async function countSqlStatements(
  action: () => Promise<unknown>,
): Promise<number> {
  const query = jest.spyOn(Client.prototype, 'query');

  try {
    await action();

    return query.mock.calls.length;
  } finally {
    query.mockRestore();
  }
}
