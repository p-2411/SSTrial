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
 * A small solid marker in the same hue (a status dot). Warning's is its border colour, the bright
 * amber: its text colour is a dark brown that wouldn't read as a warning at that size.
 */
export const TONE_DOT_CLASSES: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning-border',
  danger: 'bg-danger',
};
