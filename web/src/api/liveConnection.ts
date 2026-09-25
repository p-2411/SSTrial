import { useSyncExternalStore } from 'react';

/**
 * Whether the live update stream is connected. While it is, the server pushes changes and nothing
 * needs to poll; while it isn't, queries fall back to polling. Kept in its own module (no imports)
 * so both the stream and the queries can read it without a circular import.
 */
let connected = false;
const listeners = new Set<() => void>();

export function setLiveConnected(value: boolean): void {
  if (value === connected) return;
  connected = value;
  listeners.forEach((listener) => listener());
}

export function isLiveConnected(): boolean {
  return connected;
}

export function useLiveConnected(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => connected,
  );
}
