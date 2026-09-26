/**
 * An `ilike` pattern that finds `text` anywhere, taken literally: to `ilike`, `%` and `_` are
 * wildcards, and a backslash escapes them, so all three are escaped.
 */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
