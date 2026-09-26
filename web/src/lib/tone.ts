import type { ConfidenceBand, LogLevel } from '@label-extractor/shared';

/**
 * The app's status colours, in SupplyScope's pastel style: a soft background and border with
 * readable text in the same hue. Pills, notices and chips all take theirs from here, so a status
 * looks the same wherever it appears.
 */
export type Tone = 'success' | 'warning' | 'danger';

export const TONE_CLASSES: Record<Tone, string> = {
  success: 'border-success-border bg-success-soft text-success',
  warning: 'border-warning-border bg-warning-soft text-warning',
  danger: 'border-danger-border bg-danger-soft text-danger',
};

/**
 * Text alone in a tone's colour, on the page's own background. Two more for lines of text that
 * report nothing wrong: `brand` for work in hand (a label being read), `muted` for the rest.
 */
export type TextTone = Tone | 'brand' | 'muted';

export const TONE_TEXT_CLASSES: Record<TextTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  brand: 'text-brand',
  muted: 'text-muted-foreground',
};

/**
 * A small solid marker in the same hue (a status dot). Warning's is its border colour, the bright
 * amber: its text colour is a dark brown that wouldn't read as a warning at that size.
 */
export const TONE_DOT_CLASSES: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning-border',
  danger: 'bg-danger',
};

/** An event's level as a tone: everyday events have none; warnings and errors stand out. */
export const LEVEL_TONE: Record<LogLevel, Tone | null> = {
  info: null,
  warn: 'warning',
  error: 'danger',
};

/** A confidence band as a tone: nothing to flag has none; worth checking is amber, low is red. */
export const BAND_TONE: Record<ConfidenceBand, Tone | null> = {
  ok: null,
  check: 'warning',
  low: 'danger',
};
