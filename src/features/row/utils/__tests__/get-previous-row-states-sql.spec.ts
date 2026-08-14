import { createHash } from 'node:crypto';
import type { Prisma } from 'src/__generated__/client';
import { getPreviousRowStatesSql } from 'src/features/row/utils/get-previous-row-states-sql';

describe('getPreviousRowStatesSql physical shape', () => {
  const query = getPreviousRowStatesSql({
    revisionId: 'revision',
    tableId: 'table',
    rowId: 'row',
    first: 10,
    afterDepth: 7,
    afterRevisionId: 'after-revision',
  });
  const text = getSqlText(query);

  it('matches the captured rendered SQL and bound-value order', () => {
    const normalized = text.replace(/\s+/g, ' ').trim();

    expect(normalized).toHaveLength(10_731);
    expect(createHash('sha256').update(normalized).digest('hex')).toBe(
      '6ff127e3f3870c7f87a59b0edc1691b197eef094f438a4b89605a7c3bd8ac956',
    );
    expect(query.values).toEqual([
      'revision',
      'table',
      'row',
      10,
      7,
      'after-revision',
    ]);
    expect(text.match(/\$\d+/g)).toEqual(['$1', '$2', '$3', '$4', '$5', '$6']);
  });

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
  return query.text;
}
