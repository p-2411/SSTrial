import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

/** A grey placeholder block shown while content loads. Hidden from screen readers. */
export function Skeleton({ width = '100%', height = 14, style }: { width?: string | number; height?: number; style?: CSSProperties }) {
  return <span aria-hidden="true" className={styles.skeleton} style={{ width, height, ...style }} />;
}
