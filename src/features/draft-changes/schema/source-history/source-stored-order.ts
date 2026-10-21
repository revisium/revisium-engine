export function inStoredKeyOrder<Value>(value: Value): Value {
  return orderStoredValue(value) as Value;
}

function orderStoredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(orderStoredValue);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareStoredKeys(left, right))
      .map(([key, child]) => [key, orderStoredValue(child)]),
  );
}

function compareStoredKeys(left: string, right: string): number {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return (
    leftBytes.length - rightBytes.length ||
    Buffer.compare(leftBytes, rightBytes)
  );
}
