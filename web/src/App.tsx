import { createBrowserRouter, Link, Outlet, useMatch } from 'react-router';
import { Dropzone } from './features/upload/Dropzone.tsx';
import { useFileUploads } from './features/upload/useFileUploads.ts';
import { LabelPanelOutline } from './features/upload-detail/LabelPanel.tsx';
import { UploadDetailView } from './features/upload-detail/UploadDetailView.tsx';
import { UploadList } from './features/uploads-list/UploadList.tsx';
import styles from './App.module.css';

/**
 * Routes:
 *   /             upload + list, with a placeholder where the detail goes
 *   /uploads/:id  upload + list, with that upload's detail alongside
 * On narrow screens the list and the detail become separate pages (see App.module.css).
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Workspace />,
    children: [
      { index: true, element: <NothingSelected /> },
      { path: 'uploads/:id', element: <UploadDetailView /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

function Workspace() {
  const { uploads: pending, addFiles, retry, dismiss } = useFileUploads();
  const showingDetail = useMatch('/uploads/:id') !== null;

  return (
    <div className={styles.shell}>
      <Masthead />
      <main className={styles.workspace} data-view={showingDetail ? 'detail' : 'list'}>
        <div className={styles.listPane}>
          <Dropzone onFiles={addFiles} />
          <UploadList pending={pending} onRetryPending={retry} onDismissPending={dismiss} />
        </div>
        <div className={styles.detailPane}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function Masthead() {
  return (
    <header className={styles.masthead}>
      <Link to="/" className={styles.wordmark}>
        Label extractor
      </Link>
      <p className={styles.tagline}>Turns product label photos and PDFs into structured product data.</p>
    </header>
  );
}

function NothingSelected() {
  return (
    <LabelPanelOutline>
      Select an upload to see the product name, brand, net weight, allergens and ingredients read from its label.
    </LabelPanelOutline>
  );
}

function NotFoundPage() {
  return (
    <div className={styles.shell}>
      <Masthead />
      <main className={styles.notFound}>
        <h1>Page not found</h1>
        <p>
          There's nothing at this address. <Link to="/">Go to your uploads</Link>.
        </p>
      </main>
    </div>
  );
}
