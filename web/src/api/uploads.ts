import { RESULT_EDIT_PATH } from '@label-extractor/shared';
import type {
  EditResultRequest,
  OpsStatusResponse,
  CreateUploadRequest,
  CreateUploadResponse,
  ListUploadsResponse,
  UploadDetail,
  UploadView,
  UploadResponse,
} from '@label-extractor/shared';
import { apiFetch, apiRequest } from './client.ts';

/** Plain functions for each API endpoint. React Query hooks wrap these in queries.ts. */

/**
 * One page of a list, newest first: everyone's finished `products`, or the signed-in person's own
 * uploads still under way or failed (`mine`).
 */
export function listUploads(view: UploadView, cursor?: string): Promise<ListUploadsResponse> {
  const params = new URLSearchParams({ view });
  if (cursor) params.set('cursor', cursor);
  return apiRequest<ListUploadsResponse>(`/api/uploads?${params}`);
}

/** The queue, the worker, health checks, throughput and failures, for the System status page. */
export function getOpsStatus(): Promise<OpsStatusResponse> {
  return apiRequest<OpsStatusResponse>('/api/ops');
}

export async function getUpload(id: string): Promise<UploadDetail> {
  return (await apiRequest<UploadResponse>(`/api/uploads/${encodeURIComponent(id)}`)).upload;
}

export function createUpload(request: CreateUploadRequest): Promise<CreateUploadResponse> {
  return apiRequest<CreateUploadResponse>('/api/uploads', { method: 'POST', body: request });
}

export async function completeUpload(id: string): Promise<UploadDetail> {
  return (await apiRequest<UploadResponse>(`/api/uploads/${encodeURIComponent(id)}/complete`, { method: 'POST' })).upload;
}

/** Saves a person's corrections to an upload's data, or confirms fields as right (see EditResultRequest). */
export async function editResult(id: string, request: EditResultRequest): Promise<UploadDetail> {
  return (await apiRequest<UploadResponse>(RESULT_EDIT_PATH(id), { method: 'PATCH', body: request })).upload;
}

/** Deletes an upload and its file for good (the API answers 204, with nothing to read). */
export async function deleteUpload(id: string): Promise<void> {
  await apiFetch(`/api/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function retryUpload(id: string): Promise<UploadDetail> {
  return (await apiRequest<UploadResponse>(`/api/uploads/${encodeURIComponent(id)}/retry`, { method: 'POST' })).upload;
}

/**
 * Sends the file's bytes straight to storage using the signed URL from `createUpload`.
 *
 * Uses XMLHttpRequest rather than fetch because fetch can't report upload progress.
 */
export function putFileToStorage(
  url: string,
  file: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', contentType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(storageErrorMessage(xhr.status, xhr.responseText)));
    };
    xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'));
    xhr.send(file);
  });
}

/**
 * Storage enforces the bucket's size and type limits itself. Those rejections come back as a 4xx
 * with a JSON body like `{"statusCode":"413",…}`; translate the common ones.
 */
function storageErrorMessage(status: number, responseText: string): string {
  let code = String(status);
  try {
    code = String((JSON.parse(responseText) as { statusCode?: string }).statusCode ?? status);
  } catch {
    // Not JSON — fall back to the HTTP status.
  }
  if (code === '413') return 'This file is larger than storage allows.';
  if (code === '415') return "Storage didn't accept this file type.";
  if (code === '403' || code === '401') return 'The upload link expired. Please try again.';
  return `The upload failed (${code}). Please try again.`;
}

/**
 * Every completed extraction as a CSV or JSON file, with the file name the server chose. Fetched,
 * not linked: a plain link can't send the sign-in token. Saving it is up to the caller (saveFile).
 */
export async function fetchExport(format: 'csv' | 'json'): Promise<{ blob: Blob; fileName: string }> {
  const response = await apiFetch(`/api/exports/uploads.${format}`);
  const fileName = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? `uploads.${format}`;
  return { blob: await response.blob(), fileName };
}
