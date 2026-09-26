import { RESULT_EDIT_PATH } from '@label-extractor/shared';
import type {
  CheckUploadsResponse,
  DeleteUploadsResponse,
  EditResultRequest,
  SubmitUploadsResponse,
  RevertRequest,
  OpsStatusResponse,
  CreateUploadRequest,
  CreateUploadResponse,
  ListUploadsResponse,
  UploadDetail,
  UploadView,
  UploadResponse,
} from '@label-extractor/shared';
import { ANY_TIME, toInstants, type DayRange } from '@/lib/dayRange';
import { apiFetch, apiRequest } from './client.ts';

/** Plain functions for each API endpoint. React Query hooks wrap these in queries.ts. */

/**
 * Narrowing Products: words in a product's name, brand or file name ('' for any), and the days it
 * was added to Products in (see DayRange).
 */
export interface ProductFilter extends DayRange {
  search: string;
}

export const NO_PRODUCT_FILTER: ProductFilter = { search: '', ...ANY_TIME };

/** The filter as query parameters, which the list and the export take alike: the days as the viewer's own midnights. */
function filterParams(filter: ProductFilter, params = new URLSearchParams()): URLSearchParams {
  if (filter.search) params.set('q', filter.search);
  const { from, to } = toInstants(filter);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return params;
}

/**
 * One page of a list, newest first: the signed-in person's own uploads being read or failed
 * (`upload`), their own read uploads waiting for review (`review`), or everyone's `products`.
 */
export function listUploads(view: UploadView, cursor?: string, filter: ProductFilter = NO_PRODUCT_FILTER): Promise<ListUploadsResponse> {
  const params = filterParams(filter, new URLSearchParams({ view }));
  if (cursor) params.set('cursor', cursor);
  return apiRequest<ListUploadsResponse>(`/api/uploads?${params}`);
}

/** The queue, the worker, health checks and throughput, for the System page's status strip. */
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

/** Puts the named uploads (the asker's own, in Review) into Products: those with nothing left to check. */
export async function submitUploads(ids: string[]): Promise<string[]> {
  return (await apiRequest<SubmitUploadsResponse>('/api/uploads/submit', { method: 'POST', body: { ids } })).submitted;
}

/** Deletes the named uploads the asker may delete (their own, or any if they're an admin). */
export async function deleteUploads(ids: string[]): Promise<string[]> {
  return (await apiRequest<DeleteUploadsResponse>('/api/uploads/delete', { method: 'POST', body: { ids } })).deleted;
}

/** Marks every flagged field of the named uploads as checked, by the asker. */
export async function checkUploads(ids: string[]): Promise<string[]> {
  return (await apiRequest<CheckUploadsResponse>('/api/uploads/check', { method: 'POST', body: { ids } })).checked;
}

/** Admins only: puts an upload's data back to a version from its history. */
export async function revertUpload(id: string, request: RevertRequest): Promise<UploadDetail> {
  return (await apiRequest<UploadResponse>(`/api/uploads/${encodeURIComponent(id)}/revert`, { method: 'POST', body: request })).upload;
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
export async function fetchExport(
  format: 'csv' | 'json',
  products: { ids: string[] } | ProductFilter = NO_PRODUCT_FILTER,
): Promise<{ blob: Blob; fileName: string }> {
  const params = new URLSearchParams();
  if ('ids' in products) for (const id of products.ids) params.append('id', id);
  else filterParams(products, params);
  const response = await apiFetch(`/api/exports/uploads.${format}${params.size > 0 ? `?${params}` : ''}`);
  const fileName = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? `uploads.${format}`;
  return { blob: await response.blob(), fileName };
}
