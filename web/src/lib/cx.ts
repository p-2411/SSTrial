/** Joins class names, skipping falsy values: cx('a', isOn && 'b') → "a b" or "a". */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
