import { createHash } from 'node:crypto';
import type { Prisma } from 'src/__generated__/client';
import {
  BISECT_MAX_ROW_VERSIONS,
  getHistorySelectorSql,
  getPreviousRowStatesSql,
} from 'src/features/row/previous-row-states/sql/get-previous-row-states.sql';
import type { PreviousRowStatesSqlParams } from 'src/features/row/previous-row-states/sql/get-previous-row-states.sql';

describe('Previous row states SQL physical shape', () => {
  const params: PreviousRowStatesSqlParams = {
    tipBranchId: 'tip-branch',
    tipSequence: 42,
    projectId: 'project',
    tableCreatedId: 'table-created',
    rowCreatedId: 'row-created',
    rowVersionCount: 1,
    first: 10,
    afterSequence: 7,
    afterRevisionId: 'after-revision',
  };
  const bisect = getPreviousRowStatesSql(params);
  const scan = getPreviousRowStatesSql({
    ...params,
    rowVersionCount: BISECT_MAX_ROW_VERSIONS + 1,
  });
  const bisectText = getSqlText(bisect);
  const scanText = getSqlText(scan);

  it('matches the captured rendered SQL and bound-value order', () => {
    const boundValues = [
      'tip-branch',
      42,
      'project',
      'table-created',
      'row-created',
      10,
      7,
      'after-revision',
    ];

    expect(sha256(bisectText)).toBe(
      'ab183860b4bc9822e54d2926d77603cdb5b5141ecbf15f9ddd2dc0acad6c801a',
    );
    expect(sha256(scanText)).toBe(
      '20dad8ef05a5ce2dd182d940e9f1801facf11c3207b48f9fb5f99d98c2a54b5f',
    );
    expect(bisect.values).toEqual(boundValues);
    expect(scan.values).toEqual(boundValues);
    expect(bisectText.match(/\$\d+/g)).toEqual([
      '$1',
      '$2',
      '$3',
      '$4',
      '$5',
      '$6',
      '$7',
      '$8',
    ]);
  });

  it('walks ancestry as branch intervals, never one revision per step', () => {
    for (const text of [bisectText, scanText]) {
      expect(text).toMatch(/WITH RECURSIVE/);
      expect(text).toMatch(/start_revision\."isStart" = true/);
      expect(text).toMatch(/ANY \(child\.visited_branches\)/);
      expect(text).not.toMatch(/child\.depth \+ 1/);
      expect(text).not.toMatch(/OFFSET 0/);
    }
  });

  it('switches the introduction strategy on the row version count', () => {
    expect(bisectText).toMatch(
      /segment\.lo_seq \+ \(segment\.hi_seq - segment\.lo_seq\) \/ 2/,
    );
    expect(bisectText).toMatch(/ORDER BY floor_revision\."sequence" DESC/);
    expect(scanText).toMatch(/min\(lineage_revision\."sequence"\)/);
    expect(scanText).not.toMatch(/mid_seq/);
  });

  it('collapses copy-on-write no-ops via Row.hash before numbering events', () => {
    for (const text of [bisectText, scanText]) {
      expect(text).toMatch(/o\.parent_version_id IS NULL/);
      expect(text).toMatch(/o\.row_hash IS DISTINCT FROM o\.parent_row_hash/);
      expect(text).toMatch(/event\.event_number > 1/);
      // Full documents are read only for the hydrated page.
      expect(text.match(/version\."data"/g)).toBeNull();
    }
  });

  it('counts the full previous-event stream before keyset pagination', () => {
    for (const text of [bisectText, scanText]) {
      expect(text).toMatch(/SELECT count\(\*\) FROM previous_events/);
      expect(text).toMatch(/event\.introduced_seq < params\.after_sequence/);
      expect(text).toMatch(/LIMIT \(SELECT first_count \+ 1 FROM params\)/);
    }
  });

  it('detects a detached fork start from graph order, not Branch.isRoot', () => {
    for (const text of [bisectText, scanText]) {
      expect(text).toMatch(/first_revision\."sequence" < ls\.start_sequence/);
      expect(text).not.toMatch(/older_branch\."isRoot"/);
    }
  });

  it('resolves the tip and selector in one statement with a capped count', () => {
    const selector = getHistorySelectorSql({
      revisionId: 'revision',
      tableId: 'table',
      rowId: 'row',
    });
    const text = getSqlText(selector);

    expect(sha256(text)).toBe(
      '30a3c96ded91b9e39919fb7f965dc297c55818d9ed96898978d42a6f05c03ec6',
    );
    expect(selector.values).toEqual([
      'revision',
      'table',
      'row',
      BISECT_MAX_ROW_VERSIONS + 1,
    ]);
    expect(text).toMatch(/AS "tipIsDraft"/);
    expect(text).toMatch(/AS "selectorCount"/);
    expect(text).toMatch(/LIMIT \$4::integer/);
  });
});

function getSqlText(query: Prisma.Sql): string {
  return query.text;
}

function sha256(text: string): string {
  return createHash('sha256')
    .update(text.replace(/\s+/g, ' ').trim())
    .digest('hex');
}
