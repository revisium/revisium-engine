import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import {
  hasDifferentVersions,
  publicIdOrIdentityOf,
} from 'src/features/partial-changes/snapshot/changes-snapshot';

// A unit of a changed table that the plan did not read could be written without its rows; the read scope (SPEC §6.2)
// must make this impossible, so a plan that breaks it is an internal error and is never decided or written.
export function assertEveryAppliedTableRead(
  { snapshot, tables, catalogue }: AssemblySource,
  applied: ReadonlySet<string>,
): void {
  const changed = new Set(
    tables.filter(hasDifferentVersions).map(({ identity }) => identity),
  );
  const unread = catalogue.units
    .filter(({ key }) => applied.has(key))
    .flatMap(({ tableIdentities }) => tableIdentities)
    .find((identity) => changed.has(identity) && !catalogue.rows.has(identity));

  if (unread === undefined) {
    return;
  }

  const pair = snapshot.tables.find(({ identity }) => identity === unread);

  throw new Error(
    `The plan applies units of ${pair ? publicIdOrIdentityOf(pair) : unread}, whose changed rows it did not read`,
  );
}
