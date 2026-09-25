import styles from './ProgressBar.module.css';

/** Determinate progress (0–1), or an indeterminate stripe when `value` is omitted. */
export function ProgressBar({ value, label }: { value?: number; label: string }) {
  const percent = value === undefined ? undefined : Math.round(value * 100);
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div
        className={percent === undefined ? styles.indeterminate : styles.fill}
        style={percent === undefined ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
