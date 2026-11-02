import { Injectable } from '@nestjs/common';
import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonValue, Row } from 'src/engine-prisma-types';
import {
  oppositeOf,
  type RevisionSide,
} from 'src/features/draft-revision/commands/impl/target-write-plan';
import {
  type LinkChanges,
  NO_LINK_CHANGES,
} from 'src/features/partial-changes/assembly/link-changes';
import type {
  OutcomeRules,
  TableOutcome,
} from 'src/features/partial-changes/assembly/outcome-rules';
import type { MergedRow } from 'src/features/partial-changes/assembly/row-merger';
import {
  type SystemTableTarget,
  systemTableOutcomeOf,
  systemTableTargetsOf,
  type TableViews,
  tableViewsOf,
} from 'src/features/partial-changes/assembly/system-table-targets';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import { HeadViewsMigration } from 'src/features/partial-changes/catalogue/head-views-migration';
import type { UnitKind } from 'src/features/partial-changes/catalogue/unit';
import type {
  SystemTableRows,
  SystemTableVersionIds,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import { HashService } from 'src/infrastructure/database/hash.service';

export interface SystemTablePlan extends LinkChanges {
  readonly tableId: SystemTables;
  readonly versionIds: SystemTableVersionIds;
  readonly outcome: TableOutcome;
  readonly linkSide: RevisionSide;
  readonly versionId?: string;
  readonly relinkCandidate: boolean;
}

export interface TargetViews extends TableViews {
  readonly document: TableViewsData;
}

interface DesiredRows {
  readonly versions: readonly Row[];
  readonly newRows: readonly MergedRow[];
}

@Injectable()
export class SystemTargetAssembler {
  constructor(
    private readonly hashService: HashService,
    private readonly headViews: HeadViewsMigration,
  ) {}

  public assemble(
    source: AssemblySource,
    rules: OutcomeRules,
  ): Promise<SystemTablePlan[]> {
    return this.assemblyOf(source, rules).planSystemTables();
  }

  public viewsOf(source: AssemblySource, rules: OutcomeRules): TargetViews[] {
    return this.assemblyOf(source, rules).targetViews();
  }

  private assemblyOf(
    source: AssemblySource,
    rules: OutcomeRules,
  ): SystemTargetAssembly {
    return new SystemTargetAssembly(
      source,
      rules,
      this.headViews,
      this.hashService,
    );
  }
}

class SystemTargetAssembly {
  constructor(
    private readonly source: AssemblySource,
    private readonly rules: OutcomeRules,
    private readonly headViews: HeadViewsMigration,
    private readonly hashService: HashService,
  ) {}

  public async planSystemTables(): Promise<SystemTablePlan[]> {
    const plans: SystemTablePlan[] = [];

    for (const target of systemTableTargetsOf(this.source, this.rules)) {
      plans.push(this.planOf(target, await this.desiredRowsOf(target)));
    }

    return plans;
  }

  public targetViews(): TargetViews[] {
    return tableViewsOf(this.source, this.rules).map((views) => ({
      ...views,
      document: this.documentOf(views),
    }));
  }

  private async desiredRowsOf({
    versions,
    rewrites,
  }: SystemTableTarget): Promise<DesiredRows> {
    const rewritten: DesiredRows[] = [];

    for (const rewrite of rewrites) {
      rewritten.push(await this.rewrittenViewsOf(rewrite));
    }

    return {
      versions: [...versions, ...rewritten.flatMap(({ versions }) => versions)],
      newRows: rewritten.flatMap(({ newRows }) => newRows),
    };
  }

  private async rewrittenViewsOf(rewrite: TableViews): Promise<DesiredRows> {
    const { source, tableId } = rewrite;
    const document = this.documentOf(rewrite);

    if (source.id === tableId && deepEqual(source.data, document)) {
      return { versions: [source], newRows: [] };
    }

    const newRow: MergedRow = {
      createdId: source.createdId,
      createdAt: source.createdAt,
      id: tableId,
      data: document as unknown as JsonValue,
      hash: await this.hashService.hashObject(document),
      schemaHash: source.schemaHash,
      publishedAt: source.publishedAt,
      meta: source.meta,
    };

    return { versions: [], newRows: [newRow] };
  }

  private documentOf({
    pair,
    tableSide,
    viewsSide,
    source,
  }: TableViews): TableViewsData {
    const document = source.data as unknown as TableViewsData;

    if (viewsSide === tableSide || viewsSide === 'draft' || !pair.head) {
      return document;
    }

    return (
      this.headViews.migrate(
        document,
        pair.head.schema,
        this.source.catalogue.tables.structureOf(pair).pendingHistory,
      ) ?? document
    );
  }

  private planOf(
    target: SystemTableTarget,
    desired: DesiredRows,
  ): SystemTablePlan {
    const { tableId, rows, linkSide, ownerKinds } = target;
    const outcome = systemTableOutcomeOf(
      target,
      desired.versions,
      desired.newRows.length > 0,
    );

    return {
      tableId,
      versionIds: rows.versionIds,
      outcome,
      linkSide,
      versionId: linkedVersionIdOf(rows, outcome, linkSide),
      ...systemLinkChangesOf(outcome, rows[linkSide], desired),
      relinkCandidate: this.keepsNoUnitsOf(ownerKinds),
    };
  }

  private keepsNoUnitsOf(kinds: readonly UnitKind[]): boolean {
    return this.source.catalogue.units
      .filter(({ unit }) => kinds.includes(unit.kind))
      .every(({ key }) => this.rules.isApplied(key));
  }
}

function systemLinkChangesOf(
  outcome: TableOutcome,
  linked: readonly Row[],
  desired: DesiredRows,
): LinkChanges {
  if (outcome !== 'mixed') {
    return NO_LINK_CHANGES;
  }

  const linkedIds = versionIdsOf(linked);
  const desiredIds = versionIdsOf(desired.versions);

  return {
    removedLinks: [...linkedIds].filter((id) => !desiredIds.has(id)),
    addedLinks: [...desiredIds].filter((id) => !linkedIds.has(id)),
    newRows: desired.newRows,
  };
}

function linkedVersionIdOf(
  rows: SystemTableRows,
  outcome: TableOutcome,
  linkSide: RevisionSide,
): string | undefined {
  if (outcome === 'absent') {
    return undefined;
  }

  if (outcome === 'other') {
    return rows.versionIds[oppositeOf(linkSide)];
  }

  return rows.versionIds[linkSide];
}

function versionIdsOf(rows: readonly Row[]): Set<string> {
  return new Set(rows.map(({ versionId }) => versionId));
}
