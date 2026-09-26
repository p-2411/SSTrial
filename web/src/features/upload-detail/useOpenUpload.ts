import { useMatch, useNavigate } from 'react-router';
import { HOME_PATH, UPLOAD_PATH_PATTERN } from '@/routes';

/**
 * The upload open in the detail panel, from the address (/uploads/:id), if any. The URL is what
 * opens and closes the panel, so links, refresh and Back all work.
 */
export function useOpenUploadId(): string | undefined {
  return useMatch(UPLOAD_PATH_PATTERN)?.params.id;
}

/** Closes the detail panel: back to the list. */
export function useCloseDetail(): () => void {
  const navigate = useNavigate();
  return () => void navigate(HOME_PATH);
}
