/** ["a", "b", "c"] → "a, b or c" (or "a, b and c"). Zod-free, for UI copy and messages alike. */
export function formatList(items: readonly string[], conjunction: 'or' | 'and' = 'or'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1)}`;
}
