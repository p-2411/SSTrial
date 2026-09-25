import { describe, expect, it, vi } from 'vitest';
import { APIConnectionTimeoutError, APIError } from 'openai';
import { ExtractionError } from '../../src/extraction/errors.ts';
import {
  createOpenAIExtractor,
  type CreateResponse,
  type ModelResponse,
} from '../../src/extraction/openai-extractor.ts';
import type { LabelFile } from '../../src/extraction/extractor.ts';

// These tests never touch the network: the OpenAI call is a fake `createResponse` function that
// returns canned responses (valid, malformed, refused, truncated…) or throws SDK errors.

const PNG: LabelFile = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mimeType: 'image/png', fileName: 'label.png' };
const PDF: LabelFile = { bytes: new TextEncoder().encode('%PDF-1.7'), mimeType: 'application/pdf', fileName: 'label.pdf' };

const VALID_OUTPUT = {
  productName: 'Maple Pecan Crunch',
  brand: 'Harvest & Hearth',
  ingredients: [
    { name: 'Rolled oats', percent: 48, subIngredients: [], allergens: ['oats'] },
    { name: 'Pecans', percent: 10, subIngredients: [], allergens: ['pecans'] },
    { name: 'Puffed rice', percent: null, subIngredients: ['rice', 'salt'], allergens: [] },
  ],
  allergens: ['Oats', 'Pecans'],
  netWeight: { value: 500, unit: 'g', text: 'Net Wt 500 g' },
};

/** A successful response whose text output is `text`. */
function textResponse(text: string): ModelResponse {
  return { status: 'completed', output: [], output_text: text, incomplete_details: null, error: null };
}

function extractorReturning(response: ModelResponse | (() => never)) {
  const createResponse = vi.fn<CreateResponse>(async () =>
    typeof response === 'function' ? response() : response,
  );
  return { extractor: createOpenAIExtractor({ createResponse, model: 'test-model' }), createResponse };
}

/** Runs extraction and returns the ExtractionError it rejected with. */
async function extractionError(response: ModelResponse | (() => never)): Promise<ExtractionError> {
  const { extractor } = extractorReturning(response);
  const error = await extractor.extract(PNG).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ExtractionError);
  return error as ExtractionError;
}

/** The model's scores, as it sends them: one per field, with a reason for anything below 85. */
const MODEL_CONFIDENCE = {
  productName: { score: 97, reason: null },
  brand: { score: 95, reason: null },
  netWeight: { score: 72, reason: 'Partly hidden by a fold.' },
  allergens: { score: 90, reason: null },
  ingredients: { score: 88, reason: null },
};

describe('OpenAI extractor — valid responses', () => {
  it('returns validated, normalised data', async () => {
    const { extractor } = extractorReturning(textResponse(JSON.stringify(VALID_OUTPUT)));
    await expect(extractor.extract(PNG)).resolves.toMatchObject({ result: { ...VALID_OUTPUT, allergens: ['oats', 'pecans'] } });
  });

  it('reads how sure the model is of each field, with its reasons', async () => {
    const { extractor } = extractorReturning(textResponse(JSON.stringify({ ...VALID_OUTPUT, confidence: MODEL_CONFIDENCE })));
    const { confidence } = await extractor.extract(PNG);
    expect(confidence).toEqual({
      productName: { score: 97, reasons: [] },
      brand: { score: 95, reasons: [] },
      netWeight: { score: 72, reasons: ['Partly hidden by a fold.'] },
      allergens: { score: 90, reasons: [] },
      ingredients: { score: 88, reasons: [] },
    });
  });

  it('keeps the data when the scores are missing or malformed: they are advisory, not worth a retry', async () => {
    for (const confidence of [undefined, { productName: { score: 'high' } }, 'sure']) {
      const { extractor } = extractorReturning(textResponse(JSON.stringify({ ...VALID_OUTPUT, confidence })));
      await expect(extractor.extract(PNG)).resolves.toMatchObject({ result: { productName: 'Maple Pecan Crunch' }, confidence: null });
    }
  });

  it('keeps scores within 0–100', async () => {
    const outOfRange = { ...MODEL_CONFIDENCE, productName: { score: 140, reason: null }, brand: { score: -5, reason: 'Unreadable.' } };
    const { extractor } = extractorReturning(textResponse(JSON.stringify({ ...VALID_OUTPUT, confidence: outOfRange })));
    const { confidence } = await extractor.extract(PNG);
    expect(confidence?.productName.score).toBe(100);
    expect(confidence?.brand.score).toBe(0);
  });

  it('sends images as high-detail image input and PDFs as file input', async () => {
    const { extractor, createResponse } = extractorReturning(textResponse(JSON.stringify(VALID_OUTPUT)));
    await extractor.extract(PNG);
    await extractor.extract(PDF);

    const contentOf = (call: number) => {
      const input = createResponse.mock.calls[call]![0].input as unknown as Array<{ content: Array<Record<string, unknown>> }>;
      return input[0]!.content[0]!;
    };
    expect(contentOf(0)).toMatchObject({ type: 'input_image', detail: 'high', image_url: expect.stringMatching(/^data:image\/png;base64,/) });
    expect(contentOf(1)).toMatchObject({ type: 'input_file', filename: 'label.pdf', file_data: expect.stringMatching(/^data:application\/pdf;base64,/) });
  });

  it('requests structured output, does not store the request, and forwards the abort signal', async () => {
    const { extractor, createResponse } = extractorReturning(textResponse(JSON.stringify(VALID_OUTPUT)));
    const controller = new AbortController();
    await extractor.extract(PNG, { signal: controller.signal });

    const [body, options] = createResponse.mock.calls[0]!;
    expect(body).toMatchObject({ model: 'test-model', store: false, text: { format: { type: 'json_schema', strict: true } } });
    expect(options?.signal).toBe(controller.signal);
  });
});

describe('OpenAI extractor — malformed or unexpected responses (retryable)', () => {
  it.each([
    ['not JSON at all', 'Sure! Here is the product information: ...'],
    ['truncated JSON', '{"productName": "Maple Pecan Cr'],
    ['a JSON array', '[]'],
    ['a missing field', JSON.stringify({ ...VALID_OUTPUT, brand: undefined })],
    ['a wrong type', JSON.stringify({ ...VALID_OUTPUT, ingredients: 'oats, pecans' })],
    ['an invalid unit', JSON.stringify({ ...VALID_OUTPUT, netWeight: { value: 5, unit: 'bushels', text: '5 bushels' } })],
    ['a negative quantity', JSON.stringify({ ...VALID_OUTPUT, netWeight: { value: -500, unit: 'g', text: '-500g' } })],
    ['empty output', '   '],
  ])('rejects %s as LLM_INVALID_RESPONSE', async (_label, text) => {
    const error = await extractionError(textResponse(text));
    expect(error).toMatchObject({ code: 'LLM_INVALID_RESPONSE', retryable: true });
  });

  it('includes the validation issues in the log-only detail, not the user message', async () => {
    const error = await extractionError(textResponse(JSON.stringify({ ...VALID_OUTPUT, ingredients: 42 })));
    expect(error.detail).toContain('ingredients');
    expect(error.message).not.toContain('ingredients');
  });

  it('retries a response cut off by the output token limit', async () => {
    const error = await extractionError({
      ...textResponse('{"productName":'),
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    });
    expect(error).toMatchObject({ code: 'LLM_INVALID_RESPONSE', retryable: true });
  });

  it('retries when the provider reports the response as failed', async () => {
    const error = await extractionError({
      ...textResponse(''),
      status: 'failed',
      error: { code: 'server_error', message: 'The server had an error' },
    });
    expect(error).toMatchObject({ code: 'LLM_UNAVAILABLE', retryable: true });
  });
});

describe('OpenAI extractor — refusals (not retryable)', () => {
  it('does not retry an explicit refusal', async () => {
    const error = await extractionError({
      ...textResponse(''),
      output: [
        {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'refusal', refusal: "I can't help with that." }],
        },
      ] as ModelResponse['output'],
    });
    expect(error).toMatchObject({ code: 'LLM_REFUSED', retryable: false });
  });

  it('does not retry a content-filtered response', async () => {
    const error = await extractionError({
      ...textResponse(''),
      status: 'incomplete',
      incomplete_details: { reason: 'content_filter' },
    });
    expect(error).toMatchObject({ code: 'LLM_REFUSED', retryable: false });
  });
});

describe('OpenAI extractor — transport failures', () => {
  it('classifies SDK errors thrown by the request', async () => {
    const timeout = await extractionError(() => {
      throw new APIConnectionTimeoutError();
    });
    expect(timeout).toMatchObject({ code: 'LLM_TIMEOUT', retryable: true });

    const rateLimited = await extractionError(() => {
      throw APIError.generate(429, { error: { code: 'rate_limit_exceeded', message: 'Slow down' } }, undefined, new Headers());
    });
    expect(rateLimited).toMatchObject({ code: 'LLM_RATE_LIMITED', retryable: true });
  });
});
