import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIConnectionTimeoutError, APIError } from 'openai';
import { ExtractionError } from '../../src/extraction/errors.ts';
import type { LabelExtractor } from '../../src/extraction/extractor.ts';
import { createOpenAIExtractor, type ModelResponse } from '../../src/extraction/openai-extractor.ts';
import { MAX_EXTRACTION_ATTEMPTS } from '../../src/infra/queue.ts';
import { processUpload, type ExtractionJob, type JobOutcome } from '../../src/worker/process-upload.ts';
import { FILE_BYTES, InMemoryStorage, InMemoryUploadStore, SAMPLE_EXTRACTION, silentLogger } from '../fakes.ts';

const UPLOAD_ID = '6f1c2f1e-0000-4000-8000-000000000001';

let uploads: InMemoryUploadStore;
let storage: InMemoryStorage;

beforeEach(() => {
  uploads = new InMemoryUploadStore();
  storage = new InMemoryStorage();
  const upload = uploads.seed({ id: UPLOAD_ID, status: 'queued' });
  storage.put(upload.storagePath, FILE_BYTES.png);
});

/** An extractor that plays back a script: each call returns the next result or throws the next error. */
function scriptedExtractor(...script: Array<typeof SAMPLE_EXTRACTION | Error>): LabelExtractor & { calls: number } {
  const extractor = {
    calls: 0,
    async extract() {
      const step = script[Math.min(extractor.calls, script.length - 1)]!;
      extractor.calls += 1;
      if (step instanceof Error) throw step;
      return step;
    },
  };
  return extractor;
}

function run(extractor: LabelExtractor, job: Partial<ExtractionJob> = {}) {
  return processUpload(
    { uploads, storage, extractor, logger: silentLogger },
    { uploadId: UPLOAD_ID, attempt: 1, isFinalAttempt: false, ...job },
  );
}

/**
 * Drives processUpload the way pg-boss does: re-run on 'retry' until it succeeds, fails
 * permanently, or runs out of attempts.
 */
async function runLikeTheQueue(extractor: LabelExtractor): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  for (let attempt = 1; attempt <= MAX_EXTRACTION_ATTEMPTS; attempt++) {
    const outcome = await run(extractor, { attempt, isFinalAttempt: attempt === MAX_EXTRACTION_ATTEMPTS });
    outcomes.push(outcome);
    if (outcome.status !== 'retry') break;
  }
  return outcomes;
}

describe('processUpload — success', () => {
  it('stores the extracted data and completes the upload', async () => {
    const outcome = await run(scriptedExtractor(SAMPLE_EXTRACTION));

    expect(outcome).toEqual({ status: 'completed' });
    expect(uploads.get(UPLOAD_ID)).toMatchObject({ status: 'completed', attempts: 1, result: SAMPLE_EXTRACTION, error: null });
  });

  it('passes the file bytes, type and the abort signal to the extractor', async () => {
    const extract = vi.fn<LabelExtractor['extract']>(async () => SAMPLE_EXTRACTION);
    const signal = new AbortController().signal;
    await run({ extract }, { signal });

    expect(extract).toHaveBeenCalledWith(
      { bytes: FILE_BYTES.png, mimeType: 'image/png', fileName: 'label.png' },
      { signal },
    );
  });
});

describe('processUpload — retry behaviour', () => {
  it('schedules a retry for a transient failure, keeping the reason for the UI', async () => {
    const outcome = await run(scriptedExtractor(new APIConnectionTimeoutError()));

    expect(outcome).toMatchObject({ status: 'retry', code: 'LLM_TIMEOUT' });
    expect(uploads.get(UPLOAD_ID)).toMatchObject({
      status: 'queued',
      attempts: 1,
      error: { code: 'LLM_TIMEOUT', message: 'The AI service took too long to respond.' },
    });
  });

  it('recovers when a later attempt succeeds', async () => {
    const rateLimited = APIError.generate(429, { error: { code: 'rate_limit_exceeded', message: 'slow down' } }, undefined, new Headers());
    const extractor = scriptedExtractor(rateLimited, new APIConnectionTimeoutError(), SAMPLE_EXTRACTION);

    const outcomes = await runLikeTheQueue(extractor);

    expect(outcomes.map((o) => o.status)).toEqual(['retry', 'retry', 'completed']);
    expect(uploads.get(UPLOAD_ID)).toMatchObject({ status: 'completed', attempts: 3, error: null });
  });

  it('gives up after the final attempt, keeping the last reason', async () => {
    const extractor = scriptedExtractor(new APIConnectionTimeoutError());

    const outcomes = await runLikeTheQueue(extractor);

    expect(extractor.calls).toBe(MAX_EXTRACTION_ATTEMPTS);
    expect(outcomes.at(-1)).toMatchObject({ status: 'failed', code: 'LLM_TIMEOUT' });
    expect(uploads.get(UPLOAD_ID)).toMatchObject({
      status: 'failed',
      attempts: MAX_EXTRACTION_ATTEMPTS,
      error: {
        code: 'LLM_TIMEOUT',
        message: 'The AI service took too long to respond.',
      },
    });
  });

  it('fails immediately, without retrying, when the error is not transient', async () => {
    const badKey = APIError.generate(401, { error: { code: 'invalid_api_key', message: 'bad key' } }, undefined, new Headers());
    const extractor = scriptedExtractor(badKey);

    const outcomes = await runLikeTheQueue(extractor);

    expect(extractor.calls).toBe(1);
    expect(outcomes).toEqual([{ status: 'failed', code: 'LLM_MISCONFIGURED', message: expect.any(String) }]);
    expect(uploads.get(UPLOAD_ID)).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('retries when storage is temporarily unavailable', async () => {
    storage.unavailable = true;
    await expect(run(scriptedExtractor(SAMPLE_EXTRACTION))).resolves.toMatchObject({ status: 'retry', code: 'INTERNAL_ERROR' });
  });

  it('retries an unexpected bug rather than losing the upload', async () => {
    const outcome = await run(scriptedExtractor(new TypeError("Cannot read properties of undefined (reading 'x')")));
    expect(outcome).toMatchObject({ status: 'retry', code: 'INTERNAL_ERROR' });
    // The raw exception text is for logs; users get a plain-language message.
    expect(uploads.get(UPLOAD_ID).error?.message).toBe('Something went wrong while processing this file.');
  });
});

describe('processUpload — malformed LLM responses (through the real response parser)', () => {
  /** The real OpenAI extractor, fed canned responses instead of calling the API. */
  function extractorAnswering(...texts: string[]) {
    let call = 0;
    return createOpenAIExtractor({
      model: 'test-model',
      createResponse: async (): Promise<ModelResponse> => ({
        status: 'completed',
        output: [],
        output_text: texts[Math.min(call++, texts.length - 1)]!,
        incomplete_details: null,
        error: null,
      }),
    });
  }

  it('retries malformed JSON and succeeds when the model answers properly', async () => {
    const outcomes = await runLikeTheQueue(extractorAnswering('{"productName": "Maple', JSON.stringify(SAMPLE_EXTRACTION)));

    expect(outcomes.map((o) => o.status)).toEqual(['retry', 'completed']);
    expect(uploads.get(UPLOAD_ID).result).toEqual(SAMPLE_EXTRACTION);
  });

  it('never stores data that fails schema validation', async () => {
    const wrongShape = JSON.stringify({ ...SAMPLE_EXTRACTION, allergens: 'oats, pecans' });
    const outcomes = await runLikeTheQueue(extractorAnswering(wrongShape));

    expect(outcomes.at(-1)).toMatchObject({ status: 'failed', code: 'LLM_INVALID_RESPONSE' });
    expect(uploads.get(UPLOAD_ID)).toMatchObject({ status: 'failed', result: null });
  });
});

describe('processUpload — permanent failures', () => {
  it('fails when the file has disappeared from storage, without calling the LLM', async () => {
    storage.files.clear();
    const extractor = scriptedExtractor(SAMPLE_EXTRACTION);

    await expect(run(extractor)).resolves.toMatchObject({ status: 'failed', code: 'FILE_MISSING' });
    expect(extractor.calls).toBe(0);
  });

  it('fails when the model finds nothing label-like in the file', async () => {
    const nothing = { productName: null, brand: null, ingredients: [], allergens: [], netWeight: null };
    await expect(run(scriptedExtractor(nothing))).resolves.toMatchObject({ status: 'failed', code: 'NO_LABEL_DATA' });
    expect(uploads.get(UPLOAD_ID).error?.message).toMatch(/couldn't find any product label/i);
  });

  it('does not retry a refusal', async () => {
    const refusal = new ExtractionError('LLM_REFUSED', 'The AI service declined to process this file.', false);
    await expect(run(scriptedExtractor(refusal))).resolves.toMatchObject({ status: 'failed', code: 'LLM_REFUSED' });
  });
});

describe('processUpload — duplicate and stale jobs', () => {
  it.each(['completed', 'failed', 'uploading'] as const)('skips an upload that is %s', async (status) => {
    uploads.seed({ id: UPLOAD_ID, status });
    const extractor = scriptedExtractor(SAMPLE_EXTRACTION);

    await expect(run(extractor)).resolves.toMatchObject({ status: 'skipped' });
    expect(extractor.calls).toBe(0);
    expect(uploads.get(UPLOAD_ID).status).toBe(status);
  });

  it('skips a job whose upload no longer exists', async () => {
    uploads.rows.clear();
    await expect(run(scriptedExtractor(SAMPLE_EXTRACTION))).resolves.toMatchObject({ status: 'skipped' });
  });

  it('resumes an upload left "processing" by a crashed worker', async () => {
    uploads.seed({ id: UPLOAD_ID, status: 'processing', attempts: 1 });
    await expect(run(scriptedExtractor(SAMPLE_EXTRACTION), { attempt: 2 })).resolves.toEqual({ status: 'completed' });
    expect(uploads.get(UPLOAD_ID)).toMatchObject({ status: 'completed', attempts: 2 });
  });
});
