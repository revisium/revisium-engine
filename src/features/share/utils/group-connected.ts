export function groupConnected<T>(
  items: readonly T[],
  connects: (left: T, right: T) => boolean,
): T[][] {
  let groups: T[][] = [];

  for (const item of items) {
    const connected = groups.filter((group) =>
      group.some((member) => connects(member, item)),
    );
    const separate = groups.filter((group) => !connected.includes(group));

    groups = [...separate, [...connected.flat(), item]];
  }

  return groups;
}
