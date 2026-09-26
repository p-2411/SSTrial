import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// jsdom has no matchMedia, which the sidebar uses to ask whether the screen is narrow. The app is
// desktop-only, so tests always answer "no".
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

// jsdom has no ResizeObserver, which a tooltip's arrow uses to measure itself. Nothing in the tests
// depends on sizes, so one that never reports is enough.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
