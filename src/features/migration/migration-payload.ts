import type { JsonPatch } from '@revisium/schema-toolkit/types';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { PermanentMigrationFailure } from 'src/features/migration/exceptions/permanent-migration-failure';

const ENVELOPE_VERSION = 2;

interface PayloadEnvelope {
  version: typeof ENVELOPE_VERSION;
  patches: JsonPatch[];
  ledgerMigrationId?: string;
}

export type MigrationPayload =
  | { version: 1; patches: JsonPatch[] }
  | PayloadEnvelope;

export function encodeMigrationPayload(
  patches: JsonPatch[],
  ledgerMigrationId?: string,
): InputJsonValue {
  const envelope: PayloadEnvelope = { version: ENVELOPE_VERSION, patches };

  if (ledgerMigrationId !== undefined) {
    envelope.ledgerMigrationId = ledgerMigrationId;
  }

  return envelope as unknown as InputJsonValue;
}

export function decodeMigrationPayload(payload: unknown): MigrationPayload {
  if (Array.isArray(payload)) {
    return { version: 1, patches: payload as JsonPatch[] };
  }

  if (isPayloadEnvelope(payload)) {
    return {
      version: ENVELOPE_VERSION,
      patches: payload.patches,
      ledgerMigrationId: payload.ledgerMigrationId,
    };
  }

  throw new PermanentMigrationFailure(
    'PAYLOAD_UNSUPPORTED',
    `expected a patch array or a version ${ENVELOPE_VERSION} envelope`,
  );
}

export function ledgerMigrationIdOf(
  payload: MigrationPayload,
): string | undefined {
  return payload.version === ENVELOPE_VERSION
    ? payload.ledgerMigrationId
    : undefined;
}

function isPayloadEnvelope(payload: unknown): payload is PayloadEnvelope {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }

  const { version, patches, ledgerMigrationId } = payload as Record<
    string,
    unknown
  >;

  return (
    version === ENVELOPE_VERSION &&
    Array.isArray(patches) &&
    (ledgerMigrationId === undefined || typeof ledgerMigrationId === 'string')
  );
}
