import objectHash from 'object-hash';
import type { JsonValue, Row } from 'src/engine-prisma-types';

export interface MigrationBounds {
  readonly id: string | null;
  readonly publishedAt: Date | null;
}

export type RenumberedMigrationRow = Pick<
  Row,
  | 'createdId'
  | 'createdAt'
  | 'id'
  | 'data'
  | 'hash'
  | 'schemaHash'
  | 'publishedAt'
  | 'meta'
>;

const DATE_LENGTH = 10;
const TIMESTAMP_SECOND_LENGTH = 19;
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_NATIVE_TIMESTAMP = Date.parse('9999-12-31T23:59:59.999Z');

export function nextNativeMigrationId(bounds: MigrationBounds): string {
  const timestamp = Math.max(
    Date.now(),
    afterPublishedAt(bounds.publishedAt),
    afterExportId(bounds.id),
  );

  if (!Number.isFinite(timestamp) || timestamp > MAX_NATIVE_TIMESTAMP) {
    throw new RangeError(
      'Native migration history has exhausted the supported date range',
    );
  }

  return new Date(timestamp).toISOString();
}

export function publishedAtOf(migrationId: string): Date {
  return new Date(migrationId);
}

export function renumberedMigrationRowOf(
  source: Row,
  id: string,
): RenumberedMigrationRow {
  const data = { ...(source.data as Record<string, JsonValue>), id };

  return {
    createdId: source.createdId,
    createdAt: source.createdAt,
    schemaHash: source.schemaHash,
    meta: source.meta,
    id,
    data,
    hash: objectHash(data),
    publishedAt: publishedAtOf(id),
  };
}

function afterPublishedAt(publishedAt: Date | null): number {
  return publishedAt ? publishedAt.getTime() + 1 : 0;
}

function afterExportId(id: string | null): number {
  if (id === null) {
    return 0;
  }

  const parsed = new Date(id);
  if (Number.isFinite(parsed.getTime()) && parsed.toISOString() === id) {
    return parsed.getTime() + 1;
  }

  if (id[DATE_LENGTH] === 't') {
    const displayedDay = Date.parse(`${id.slice(0, DATE_LENGTH)}T00:00:00Z`);
    return displayedDay + MILLISECONDS_PER_DAY;
  }

  const displayedSecond = Date.parse(
    `${id.slice(0, TIMESTAMP_SECOND_LENGTH)}Z`,
  );
  return displayedSecond + MILLISECONDS_PER_SECOND;
}
