/**
 * Whether the live update stream is connected. While it is, the server pushes changes and nothing
 * needs to poll; while it isn't, queries fall back to polling. Kept in its own module (no imports)
 * so both the stream and the queries can read it without a circular import.
 */
let connected = false;

export function setLiveConnected(value: boolean): void {
  connected = value;
}

export function isLiveConnected(): boolean {
  return connected;
}
