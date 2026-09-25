import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../lib/cx.ts';
import styles from './Button.module.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the main action on screen. secondary: other actions. quiet: low-emphasis (Dismiss). */
  variant?: 'primary' | 'secondary' | 'quiet';
  size?: 'md' | 'sm';
}

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cx(styles.button, styles[variant], styles[size], className)} {...props} />;
}
