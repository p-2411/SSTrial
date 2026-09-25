import type {
  CreateUploadRequest,
  CreateUploadResponse,
  ListUploadsResponse,
  UploadCountsResponse,
  UploadDetail,
  UploadFilter,
  UploadResponse,
} from '@label-extractor/shared';
import { apiRequest } from './client.ts';

/** Plain functions for each API endpoint. React Query hooks wrap these in queries.ts. */

/** One page of the list, filtered and ordered by the server. */
export function listUploads(status: UploadFilter, cursor?: string): Promise<ListUploadsResponse> {
  const params = new URLSearchParams({ status });
  if (cursor) params.set('cursor', cursor);
  return apiRequest<ListUploadsResponse>(`/api/uploads?${params}`);
}

export async function getUploadCounts(): Promise<UploadCountsResponse['counts']> {
  return (await apiRequest<UploadCountsResponse>('/api/uploads/counts')).counts;
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
