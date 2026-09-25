import { createClient } from '@supabase/supabase-js';

/**
 * Where uploaded files live. The rest of the server only sees this interface, so tests use an
 * in-memory fake and swapping Supabase Storage for S3/R2 later means one new implementation.
 */
export interface FileStorage {
  /** A URL the browser can `PUT` the file's bytes to, valid for this one object path only. */
  createUploadUrl(path: string): Promise<string>;
  /** A short-lived URL for viewing the file, or `null` if it doesn't exist. */
  createDownloadUrl(path: string, expiresInSeconds: number): Promise<string | null>;
  /** Up to `byteCount` leading bytes of the file, or `null` if it doesn't exist. */
  readHead(path: string, byteCount: number): Promise<Uint8Array | null>;
  /** The whole file, or `null` if it doesn't exist. */
  download(path: string): Promise<Uint8Array | null>;
}

/** Thrown when storage itself is unreachable or errors — as opposed to a file simply not existing. */
export class StorageUnavailableError extends Error {
  override name = 'StorageUnavailableError';
}

export function createSupabaseStorage(options: { url: string; secretKey: string; bucket: string }): FileStorage {
  const client = createClient(options.url, options.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = () => client.storage.from(options.bucket);

  async function createDownloadUrl(path: string, expiresInSeconds: number): Promise<string | null> {
    const { data, error } = await bucket().createSignedUrl(path, expiresInSeconds);
    if (error) {
      if (isNotFound(error)) return null;
      throw new StorageUnavailableError(`Could not create download URL: ${error.message}`, { cause: error });
    }
    return data.signedUrl;
  }

  return {
    createDownloadUrl,

    async createUploadUrl(path) {
      const { data, error } = await bucket().createSignedUploadUrl(path);
      if (error) throw new StorageUnavailableError(`Could not create upload URL: ${error.message}`, { cause: error });
      return data.signedUrl;
    },

    async readHead(path, byteCount) {
      // Supabase's download helper always fetches the whole object, so go via a signed URL and ask
      // for just the first bytes with an HTTP Range request.
      const url = await createDownloadUrl(path, 60);
      if (!url) return null;
      const response = await fetch(url, { headers: { Range: `bytes=0-${byteCount - 1}` } });
      if (response.status === 404 || response.status === 400) return null;
      if (!response.ok) throw new StorageUnavailableError(`Storage responded ${response.status} reading ${path}`);
      // If the server ignored the Range header we'd get the whole file; only keep what we asked for.
      return (await readAtMost(response, byteCount));
    },

    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error) {
        if (isNotFound(error)) return null;
        throw new StorageUnavailableError(`Could not download ${path}: ${error.message}`, { cause: error });
      }
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

/** Supabase reports a missing object as 400 or 404 depending on the endpoint. */
function isNotFound(error: { message: string; status?: number; statusCode?: string }): boolean {
  return (
    error.status === 404 ||
    error.statusCode === '404' ||
    /not[\s_]?found/i.test(error.message)
  );
}

async function readAtMost(response: Response, byteCount: number): Promise<Uint8Array> {
  const result = new Uint8Array(byteCount);
  let filled = 0;
  const reader = response.body?.getReader();
  if (!reader) return result.subarray(0, 0);
  while (filled < byteCount) {
    const { done, value } = await reader.read();
    if (done) break;
    const take = Math.min(value.length, byteCount - filled);
    result.set(value.subarray(0, take), filled);
    filled += take;
  }
  // Stop downloading the rest of the file.
  await reader.cancel().catch(() => {});
  return result.subarray(0, filled);
}
