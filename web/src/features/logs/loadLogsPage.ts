/**
 * Loads the Logs page's code, which is split out of the main bundle like the System status page
 * (see loadSystemStatusPage): the route renders it, and the sidebar link starts the download on
 * hover or focus.
 */
export const loadLogsPage = () => import('./LogsPage');
