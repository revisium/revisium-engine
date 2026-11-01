import { compareCodePoints } from 'src/features/partial-changes/catalogue/unit-order';

interface VersionPair {
  readonly identity: string;
  readonly head?: { readonly id: string };
  readonly draft?: { readonly id: string };
}

export function groupBySharedPublicId<T extends VersionPair>(
  pairs: readonly T[],
): T[][] {
  return groupLinkedPairs(pairs, () => true);
}

export function groupRecreations<T extends VersionPair>(
  pairs: readonly T[],
): T[][] {
  return groupLinkedPairs(pairs, isOnOneSide);
}

export function publicIdOf(group: readonly VersionPair[]): string {
  const [publicId] = [...idsOn(group, 'draft'), ...idsOn(group, 'head')];

  if (publicId === undefined) {
    throw new Error('A group of versions holds no public id');
  }

  return publicId;
}

function groupLinkedPairs<T extends VersionPair>(
  pairs: readonly T[],
  linksByPublicId: (pair: T) => boolean,
): T[][] {
  const alone = pairs
    .filter((pair) => !linksByPublicId(pair))
    .map((pair) => [pair]);
  let linked: T[][] = [];

  for (const pair of pairs.filter(linksByPublicId)) {
    const sharing = linked.filter((group) =>
      group.some((member) => holdCommonPublicId(member, pair)),
    );
    const separate = linked.filter((group) => !sharing.includes(group));

    linked = [...separate, [...sharing.flat(), pair]];
  }

  return [...alone, ...linked.map(inIdentityOrder)];
}

function holdCommonPublicId(left: VersionPair, right: VersionPair): boolean {
  const rightIds = publicIdsOf(right);

  return publicIdsOf(left).some((publicId) => rightIds.includes(publicId));
}

export function publicIdsOf({ head, draft }: VersionPair): string[] {
  return [head?.id, draft?.id].filter(
    (publicId): publicId is string => publicId !== undefined,
  );
}

function idsOn(
  group: readonly VersionPair[],
  side: 'head' | 'draft',
): string[] {
  return group
    .flatMap((pair) => {
      const version = pair[side];

      if (!version) {
        return [];
      }

      return [version.id];
    })
    .sort(compareCodePoints);
}

function inIdentityOrder<T extends VersionPair>(group: readonly T[]): T[] {
  return [...group].sort((left, right) =>
    compareCodePoints(left.identity, right.identity),
  );
}

function isOnOneSide({ head, draft }: VersionPair): boolean {
  return (head === undefined) !== (draft === undefined);
}
