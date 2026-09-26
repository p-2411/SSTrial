/** Words that keep their capital mid-sentence: an abbreviation ("AI"), or a month ("Sep 3"). */
const KEEPS_ITS_CAPITAL = /^(?:[A-Z]{2,}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/;

/**
 * A label as it reads after another word: "Show errors only", "Added last 7 days". Its first
 * letter goes lower case, unless its first word keeps its capital anyway ("Added Sep 3",
 * "Show AI requests paused").
 */
export function midSentence(label: string): string {
  return KEEPS_ITS_CAPITAL.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/** "database and queue" → "Database and queue": for a phrase that starts a sentence. */
export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
