import type { Prisma } from 'src/__generated__/client';
import { getPreviousRowStatesSql } from 'src/features/row/utils/get-previous-row-states-sql';

describe('getPreviousRowStatesSql physical shape', () => {
  const query = getPreviousRowStatesSql({
    revisionId: 'revision',
    tableId: 'table',
    rowId: 'row',
    first: 10,
    afterDepth: null,
    afterRevisionId: null,
  });
  const text = getSqlText(query);

  it('carries ancestry depth in one recursive CTE', () => {
    expect(text).toMatch(/WITH RECURSIVE/);
    expect(text).toMatch(/child\.depth \+ 1/);
    expect(text).not.toMatch(/path\s*\|\|/i);
  });

  it('preserves forced createdId and M:N correlation boundaries', () => {
    expect(text).toMatch(
      /WHERE candidate\."createdId" = s\.table_created_id\s+OFFSET 0/,
    );
    expect(text).toMatch(
      /WHERE candidate\."B" = table_version\.table_version_id\s+OFFSET 0/,
    );
    expect(text).toMatch(
      /WHERE candidate\."createdId" = s\.row_created_id\s+OFFSET 0/,
    );
    expect(text).toMatch(
      /WHERE candidate\."A" = row_version\.row_version_id\s+OFFSET 0/,
    );
  });

  it('counts the full previous-event stream before depth keyset pagination', () => {
    expect(text).toMatch(/SELECT count\(\*\) FROM previous_events/);
    expect(text).toMatch(/event\.depth > params\.after_depth/);
    expect(text).toMatch(/LIMIT \(SELECT first_count \+ 1 FROM params\)/);
  });

  it('detects a detached fork start from graph order, not Branch.isRoot', () => {
    expect(text).toMatch(/older_revision\."sequence" < deepest\.sequence/);
    expect(text).not.toMatch(/branch_is_root/);
  });
});

function getSqlText(query: Prisma.Sql): string {
  return query.strings.join('?');
}
