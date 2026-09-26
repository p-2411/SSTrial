/**
 * Loads the System status page's code, which is split out of the main bundle: most visits never
 * open it. Used by the /status route to render it, and by the sidebar link to start the download
 * on hover or focus, so it's usually ready by the time of the click. The module system caches the
 * import, so calling this repeatedly is free.
 */
export const loadSystemStatusPage = () => import('./SystemStatusPage');
