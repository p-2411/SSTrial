import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtractionError } from '../../src/extraction/errors.ts';
import type { LabelExtractor } from '../../src/extraction/extractor.ts';
import { createOpenAIExtractor, type ModelResponse } from '../../src/extraction/openai-extractor.ts';
import { MAX_EXTRACTION_ATTEMPTS } from '../../src/uploads/jobs.ts';
import { processUpload, type ExtractionJob, type JobOutcome } from '../../src/worker/process-upload.ts';
import {
  FakeRateLimiter,
  FILE_BYTES,
  InMemoryEventStore,
  InMemoryStorage,
  InMemoryUploadStore,
  SAMPLE_EXTRACTION,
  silentLogger,
} from '../fakes.ts';

const UPLOAD_ID = '6f1c2f1e-0000-4000-8000-000000000001';

let uploads: InMemoryUploadStore;
let storage: InMemoryStorage;
let rateLimiter: FakeRateLimiter;
let events: InMemoryEventStore;

beforeEach(() => {
  uploads = new InMemoryUploadStore();
  storage = new InMemoryStorage();
  rateLimiter = new FakeRateLimiter();
  events = new InMemoryEventStore();
  const upload = uploads.seed({ id: UPLOAD_ID, status: 'queued' });
  storage.put(upload.storagePath, FILE_BYTES.png);
});

// Extractors reject with ExtractionErrors (see LabelExtractor); these are what the OpenAI one throws.
const timeout = () => new ExtractionError('LLM_TIMEOUT');
const badKey = () => new ExtractionError('LLM_MISCONFIGURED', 'HTTP 401 invalid_api_key');
const rateLimited = (providerBackoffMs: number) => new ExtractionError('LLM_RATE_LIMITED', 'HTTP 429', { providerBackoffMs });

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
    { uploads, storage, extractor, rateLimiter, events, logger: silentLogger },
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
    expect(events.events).toMatchObject([
      { type: 'extraction.started', uploadId: UPLOAD_ID, data: { attempt: 1 } },
      { type: 'extraction.completed', uploadId: UPLOAD_ID, level: 'info', data: { productName: 'Maple Pecan Crunch' } },
    ]);
    expect(events.events[1]!.data.durationMs).toEqual(expect.any(Number));
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
    const outcome = await run(scriptedExtractor(timeout()));

    expect(outcome).toMatchObject({ status: 'retry', code: 'LLM_TIMEOUT' });
    expect(uploads.get(UPLOAD_ID)).toMatchObject({
      status: 'queued',
      attempts: 1,
      error: { code: 'LLM_TIMEOUT' },
    });
    expect(events.events.at(-1)).toMatchObject({ type: 'extraction.retry_scheduled', level: 'warn', data: { code: 'LLM_TIMEOUT', attempt: 1 } });
  });

  it('recovers when a later attempt succeeds', async () => {
    const extractor = scriptedExtractor(rateLimited(10_000), timeout(), SAMPLE_EXTRACTION);

    const outcomes = await runLikeTheQueue(extractor);

    expect(outcomes.map((o) => o.status)).toEqual(['retry', 'retry', 'completed']);
    expect(uploads.get(UPLOAD_ID)).toMatchObject({ status: 'completed', attempts: 3, error: null });
  });

  it('gives up after the final attempt, keeping the last reason', async () => {
    const extractor = scriptedExtractor(timeout());

    const outcomes = await runLikeTheQueue(extractor);

    expect(extractor.calls).toBe(MAX_EXTRACTION_ATTEMPTS);
    expect(outcomes.at(-1)).toMatchObject({ status: 'failed', code: 'LLM_TIMEOUT' });
    expect(uploads.get(UPLOAD_ID)).toMatchObject({
      status: 'failed',
      attempts: MAX_EXTRACTION_ATTEMPTS,
      error: { code: 'LLM_TIMEOUT' },
    });
    const failed = events.events.at(-1)!;
    expect(failed).toMatchObject({ type: 'extraction.failed', level: 'error', data: { code: 'LLM_TIMEOUT' } });
    expect(failed.message).toContain(`Gave up after ${MAX_EXTRACTION_ATTEMPTS} attempts`);
  });

  it('fails immediately, without retrying, when the error is not transient', async () => {
    const extractor = scriptedExtractor(badKey());

    const outcomes = await runLikeTheQueue(extractor);

    expect(extractor.calls).toBe(1);
    expect(outcomes).toEqual([{ status: 'failed', code: 'LLM_MISCONFIGURED' }]);
    expect(uploads.get(UPLOAD_ID)).toMatchObject({ status: 'failed', attempts: 1 });
    expect(events.types).toEqual(['extraction.started', 'extraction.failed']);
    expect(events.events[1]!.message).toContain("Retrying wouldn't help");
  });

  it('retries when storage is temporarily unavailable', async () => {
    storage.unavailable = true;
    await expect(run(scriptedExtractor(SAMPLE_EXTRACTION))).resolves.toMatchObject({ status: 'retry', code: 'INTERNAL_ERROR' });
  });

  it('retries an unexpected bug rather than losing the upload', async () => {
    const outcome = await run(scriptedExtractor(new TypeError("Cannot read properties of undefined (reading 'x')")));
    expect(outcome).toMatchObject({ status: 'retry', code: 'INTERNAL_ERROR' });
    // Only the code is stored; the raw exception text goes to the logs, never to users.
    expect(uploads.get(UPLOAD_ID).error).toEqual({ code: 'INTERNAL_ERROR' });
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
    expect(uploads.get(UPLOAD_ID).error).toEqual({ code: 'NO_LABEL_DATA' });
  });

  it('does not retry a refusal', async () => {
    const refusal = new ExtractionError('LLM_REFUSED');
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
    expect(events.types).toEqual([]); // a stale delivery isn't worth a log line
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

describe('processUpload — identical files', () => {
  it('reuses the result of a completed upload of the same bytes instead of calling the LLM', async () => {
    const hash = createHash('sha256').update(FILE_BYTES.png).digest('hex');
    uploads.seed({ id: 'twin', status: 'completed', contentSha256: hash, result: SAMPLE_EXTRACTION });
    const extractor = scriptedExtractor(timeout());

    await expect(run(extractor)).resolves.toEqual({ status: 'completed' });
    expect(extractor.calls).toBe(0);
    expect(uploads.get(UPLOAD_ID)).toMatchObject({ status: 'completed', result: SAMPLE_EXTRACTION, contentSha256: hash });
    expect(events.events.at(-1)).toMatchObject({ type: 'extraction.completed', data: { reusedFrom: 'twin' } });
    expect(events.events.at(-1)!.message).toContain('reused the result of an identical file');
  });

  it("records the real hash even when the browser's claim was wrong", async () => {
    uploads.seed({ id: UPLOAD_ID, status: 'queued', contentSha256: 'f'.repeat(64) });

    await run(scriptedExtractor(SAMPLE_EXTRACTION));

    expect(uploads.get(UPLOAD_ID).contentSha256).toBe(createHash('sha256').update(FILE_BYTES.png).digest('hex'));
  });

  it('does not reuse a failed upload of the same file', async () => {
    const hash = createHash('sha256').update(FILE_BYTES.png).digest('hex');
    uploads.seed({ id: 'twin', status: 'failed', contentSha256: hash, error: { code: 'LLM_TIMEOUT' } });
    const extractor = scriptedExtractor(SAMPLE_EXTRACTION);

    await run(extractor);

    expect(extractor.calls).toBe(1);
  });
});

describe('processUpload — shared rate limiting', () => {
  it('takes a slot from the shared limiter before each LLM call', async () => {
    await run(scriptedExtractor(SAMPLE_EXTRACTION));
    expect(rateLimiter.acquired).toBe(1);
  });

  it('pauses every worker for as long as the provider asked, and retries the job', async () => {
    await expect(run(scriptedExtractor(rateLimited(7000)))).resolves.toMatchObject({ status: 'retry', code: 'LLM_RATE_LIMITED' });
    expect(rateLimiter.pauses).toEqual([7000]);
    expect(events.types).toEqual(['extraction.started', 'ratelimit.paused', 'extraction.retry_scheduled']);
    expect(events.events[1]).toMatchObject({ level: 'warn', data: { pauseMs: 7000 } });
  });


  it('gives the job back to the queue, without calling the LLM or pausing, when our own limiter is full', async () => {
    rateLimiter.refuse = true;
    const extractor = scriptedExtractor(SAMPLE_EXTRACTION);

    await expect(run(extractor)).resolves.toMatchObject({ status: 'retry', code: 'LLM_RATE_LIMITED' });
    expect(extractor.calls).toBe(0);
    expect(rateLimiter.pauses).toEqual([]);
  });

  it("does not take a slot when an identical file's result is reused", async () => {
    const hash = createHash('sha256').update(FILE_BYTES.png).digest('hex');
    uploads.seed({ id: 'twin', status: 'completed', contentSha256: hash, result: SAMPLE_EXTRACTION });

    await run(scriptedExtractor(SAMPLE_EXTRACTION));
    expect(rateLimiter.acquired).toBe(0);
  });
});

describe('processUpload — an attempt taken over by another worker', () => {
  /**
   * An extractor that, while "calling the LLM", lets another worker take the upload over — what
   * happens when this worker stops heartbeating (e.g. it lost the database) and the job is handed on.
   */
  function takenOverWhile(outcome: typeof SAMPLE_EXTRACTION | Error): LabelExtractor {
    return {
      async extract() {
        await uploads.startAttempt(UPLOAD_ID); // the other worker's attempt claims the upload
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    };
  }

  it("can't save its result over the attempt that took over", async () => {
    await expect(run(takenOverWhile(SAMPLE_EXTRACTION))).resolves.toMatchObject({ status: 'skipped' });
    // Still owned by, and waiting on, the attempt that took over.
    expect(uploads.get(UPLOAD_ID)).toMatchObject({ status: 'processing', result: null, attempts: 2 });
    expect(events.types).toEqual(['extraction.started']); // no completion it didn't make
  });

  it("can't schedule a retry or fail the upload either", async () => {
    await expect(run(takenOverWhile(timeout()))).resolves.toMatchObject({ status: 'skipped' });
    expect(uploads.get(UPLOAD_ID)).toMatchObject({ status: 'processing', error: null });

    await expect(run(takenOverWhile(badKey()), { attempt: 2 })).resolves.toMatchObject({ status: 'skipped' });
    expect(uploads.get(UPLOAD_ID).status).toBe('processing');
  });

  it('the attempt that took over finishes normally', async () => {
    await run(takenOverWhile(SAMPLE_EXTRACTION)); // stood down
    await expect(run(scriptedExtractor(SAMPLE_EXTRACTION), { attempt: 3 })).resolves.toEqual({ status: 'completed' });
    expect(uploads.get(UPLOAD_ID)).toMatchObject({ status: 'completed', result: SAMPLE_EXTRACTION, claimToken: null });
  });
});

