const SEPARATOR = '/';
const INVALID_ESCAPE = /~(?![01])/;

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

  public valueIn(data: unknown): unknown {
    return this.segments.reduce<unknown>(
      (value, segment) => ownPropertyOf(value, segment),
      data,
    );
  }

  public assignIn(data: unknown, value: unknown): void {
    const name = this.segments.at(-1);
    const holder = new JsonPointer(this.segments.slice(0, -1)).valueIn(data);

    if (name === undefined || !isObject(holder)) {
      throw new Error(`No object holds "${this.toString()}"`);
    }

    holder[name] = value;
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

function ownPropertyOf(value: unknown, name: string): unknown {
  if (!isObject(value) || !Object.prototype.hasOwnProperty.call(value, name)) {
    return undefined;
  }

  return value[name];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
