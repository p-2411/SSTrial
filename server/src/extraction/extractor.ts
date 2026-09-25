import type { LabelExtraction, SupportedMimeType } from '@label-extractor/shared';

/** A file to extract label data from. */
export interface LabelFile {
  bytes: Uint8Array;
  mimeType: SupportedMimeType;
  fileName: string;
}

/**
 * The seam between the worker and the LLM. The worker only depends on this interface, so tests
 * substitute a fake and never call a real model; switching providers means one new implementation.
 *
 * Implementations must either resolve with data that has passed `labelExtractionSchema`, or
 * reject with an `ExtractionError` saying whether the failure is worth retrying.
 */
export interface LabelExtractor {
  extract(file: LabelFile, options?: { signal?: AbortSignal }): Promise<LabelExtraction>;
}
