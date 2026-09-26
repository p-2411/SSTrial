/** When the page last reloaded to pick up a new build (in session storage, so per tab). */
const RELOADED_AT_KEY = 'reloaded-for-new-build-at';
/** A second failure within this long of that reload means reloading didn't help. */
const RELOAD_AGAIN_AFTER_MS = 10_000;

interface Options {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  reload?: () => void;
  now?: () => number;
}

/**
 * Loads a page's code, which is split out of the main bundle and fetched on first visit (the
 * System status page, the Activity log). After a deploy, a tab opened before it still asks for the
 * old build's files, which are gone, so the load fails. Rather than crash, the page reloads, which
 * fetches the new build. Only once: if the load fails again right after that reload, the file is
 * really missing (or the network is down), and the error is let through instead of looping.
 */
export async function loadPageCode<Code>(load: () => Promise<Code>, options: Options = {}): Promise<Code> {
  try {
    return await load();
  } catch (error) {
    if (!reloadForNewBuild(options)) throw error;
    // The reload replaces the page; until then, show nothing rather than an error.
    return new Promise<never>(() => {});
  }
}

/** Reloads, unless it already did so moments ago (or can't tell). Says whether it did. */
function reloadForNewBuild({
  storage = sessionStorage,
  reload = () => window.location.reload(),
  now = Date.now,
}: Options): boolean {
  try {
    const last = storage.getItem(RELOADED_AT_KEY);
    if (last !== null && now() - Number(last) < RELOAD_AGAIN_AFTER_MS) return false;
    storage.setItem(RELOADED_AT_KEY, String(now()));
  } catch {
    return false; // storage blocked: with no way to remember, never reload
  }
  reload();
  return true;
}
