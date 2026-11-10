import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';

const SEGMENT_SEPARATOR = '.';

// The native value diff joins the keys and array indexes of a path with dots; field names hold no dot.
export function pointerOfNativeFieldPath(fieldPath: string): JsonPointer {
  if (fieldPath === '') {
    return JsonPointer.root;
  }

  return fieldPath
    .split(SEGMENT_SEPARATOR)
    .reduce((pointer, segment) => pointer.child(segment), JsonPointer.root);
}
