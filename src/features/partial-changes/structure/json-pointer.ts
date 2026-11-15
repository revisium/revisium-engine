const SEPARATOR = '/';
const INVALID_ESCAPE = /~(?![01])/;
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;

export class JsonPointer {
  public static readonly root = new JsonPointer([]);

  private constructor(public readonly segments: readonly string[]) {}

  public static isValid(text: string): boolean {
    return (
      text === '' || (text.startsWith(SEPARATOR) && !INVALID_ESCAPE.test(text))
    );
  }

  public static parse(text: string): JsonPointer {
    if (!JsonPointer.isValid(text)) {
      throw new Error(`Invalid JSON Pointer "${text}"`);
    }

    if (text === '') {
      return JsonPointer.root;
    }

    return new JsonPointer(
      text.slice(SEPARATOR.length).split(SEPARATOR).map(unescapeSegment),
    );
  }

  public child(segment: string): JsonPointer {
    return new JsonPointer([...this.segments, segment]);
  }

  public isAtOrAbove(other: JsonPointer): boolean {
    return (
      this.segments.length <= other.segments.length &&
      this.segments.every((segment, index) => segment === other.segments[index])
    );
  }

  public relocated(from: JsonPointer, to: JsonPointer): JsonPointer {
    return new JsonPointer([
      ...to.segments,
      ...this.segments.slice(from.segments.length),
    ]);
  }

  // Follows JSON only: an object member by its key, an array element by its canonical index; undefined when the
  // document holds no value at the pointer.
  public valueIn(data: unknown): unknown {
    return this.segments.reduce<unknown>(
      (value, segment) => memberOf(value, segment),
      data,
    );
  }

  public assignIn(data: unknown, value: unknown): unknown {
    const name = this.segments.at(-1);

    if (name === undefined) {
      return value;
    }

    const holder = new JsonPointer(this.segments.slice(0, -1)).valueIn(data);

    if (!isObject(holder)) {
      throw new Error(`No object holds "${this.toString()}"`);
    }

    holder[name] = value;

    return data;
  }

  public toString(): string {
    return this.segments
      .map((segment) => `${SEPARATOR}${escapeSegment(segment)}`)
      .join('');
  }
}

function escapeSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function unescapeSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function memberOf(value: unknown, segment: string): unknown {
  if (Array.isArray(value)) {
    return elementOf(value, segment);
  }

  if (
    !isObject(value) ||
    !Object.prototype.hasOwnProperty.call(value, segment)
  ) {
    return undefined;
  }

  return value[segment];
}

function elementOf(array: readonly unknown[], segment: string): unknown {
  if (!ARRAY_INDEX.test(segment)) {
    return undefined;
  }

  const index = Number(segment);

  if (index >= array.length) {
    return undefined;
  }

  return array[index];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
