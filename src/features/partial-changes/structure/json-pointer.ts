const SEPARATOR = '/';
const INVALID_ESCAPE = /~(?![01])/;

export class JsonPointer {
  public static readonly root = new JsonPointer([]);

  private constructor(public readonly segments: readonly string[]) {}

  public static parse(text: string): JsonPointer {
    if (text === '') {
      return JsonPointer.root;
    }

    if (!text.startsWith(SEPARATOR) || INVALID_ESCAPE.test(text)) {
      throw new Error(`Invalid JSON Pointer "${text}"`);
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
