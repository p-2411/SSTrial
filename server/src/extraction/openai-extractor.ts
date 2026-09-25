import OpenAI from 'openai';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInputContent,
} from 'openai/resources/responses/responses';
import { z } from 'zod';
import { CONFIDENCE_FIELDS, labelExtractionSchema, type ExtractionConfidence } from '@label-extractor/shared';
import { ExtractionError } from './errors.ts';
import { classifyOpenAIError } from './openai-errors.ts';
import type { ExtractedLabel, LabelExtractor, LabelFile } from './extractor.ts';
import { EXTRACTION_INSTRUCTIONS, EXTRACTION_USER_PROMPT, LABEL_RESPONSE_FORMAT } from './prompt.ts';

/**
 * LabelExtractor backed by the OpenAI Responses API.
 *
 * The only thing it needs from the SDK is "create a response", injected as a function. Tests pass
 * a fake that returns canned (often deliberately broken) responses or throws SDK errors.
 */

/** The subset of a Responses API result we read. */
export type ModelResponse = Pick<Response, 'status' | 'output' | 'output_text' | 'incomplete_details' | 'error'>;

export type CreateResponse = (
  body: ResponseCreateParamsNonStreaming,
  options?: { signal?: AbortSignal },
) => Promise<ModelResponse>;

export interface OpenAIExtractorOptions {
  createResponse: CreateResponse;
  model: string;
}

/** Caps output (including any reasoning tokens) so a runaway generation can't bill forever. */
const MAX_OUTPUT_TOKENS = 8_000;

export function createOpenAIExtractor(options: OpenAIExtractorOptions): LabelExtractor {
  return {
    async extract(file, { signal } = {}) {
      let response: ModelResponse;
      try {
        response = await options.createResponse(
          {
            model: options.model,
            instructions: EXTRACTION_INSTRUCTIONS,
            input: [
              {
                role: 'user',
                content: [toModelInput(file), { type: 'input_text', text: EXTRACTION_USER_PROMPT }],
              },
            ],
            text: { format: LABEL_RESPONSE_FORMAT },
            max_output_tokens: MAX_OUTPUT_TOKENS,
            // Don't keep users' label images on OpenAI's side beyond this request.
            store: false,
          },
          { signal },
        );
      } catch (error) {
        throw classifyOpenAIError(error);
      }
      return parseModelResponse(response);
    },
  };
}

/**
 * Creates the real SDK-backed `createResponse`. SDK-level retries are disabled on purpose: the job
 * queue owns retries, so there's one retry policy, with back-off that survives restarts and an
 * attempt count the user can see.
 */
export function createOpenAIResponses(options: { apiKey: string; timeoutMs: number }): CreateResponse {
  const client = new OpenAI({ apiKey: options.apiKey, timeout: options.timeoutMs, maxRetries: 0 });
  return (body, requestOptions) => client.responses.create(body, requestOptions);
}

/** Turns a raw model response into validated data, or throws an ExtractionError explaining what was wrong with it. */
function parseModelResponse(response: ModelResponse): ExtractedLabel {
  if (response.status === 'failed') {
    throw new ExtractionError(
      'LLM_UNAVAILABLE',
      response.error ? `Response failed: ${response.error.code}: ${response.error.message}` : 'Response status: failed',
    );
  }

  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason ?? 'unknown';
    if (reason === 'content_filter') {
      throw new ExtractionError('LLM_REFUSED', `Incomplete: ${reason}`);
    }
    // Usually hitting max_output_tokens mid-JSON. Output length varies run to run, so retry.
    throw new ExtractionError('LLM_INVALID_RESPONSE', `Response cut off: ${reason}`);
  }

  const refusal = findRefusal(response);
  if (refusal !== null) {
    throw new ExtractionError('LLM_REFUSED', `Refusal: ${refusal}`);
  }

  const text = response.output_text?.trim();
  if (!text) {
    throw new ExtractionError('LLM_INVALID_RESPONSE', 'Empty response');
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ExtractionError('LLM_INVALID_RESPONSE', `Not valid JSON: ${text.slice(0, 200)}`);
  }

  const parsed = labelExtractionSchema.safeParse(json);
  if (!parsed.success) {
    throw new ExtractionError(
      'LLM_INVALID_RESPONSE',
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
    );
  }
  return { result: parsed.data, confidence: parseConfidence((json as { confidence?: unknown }).confidence) };
}

function toModelInput(file: LabelFile): ResponseInputContent {
  const dataUrl = `data:${file.mimeType};base64,${Buffer.from(file.bytes).toString('base64')}`;
  if (file.mimeType === 'application/pdf') {
    return { type: 'input_file', filename: file.fileName, file_data: dataUrl };
  }
  // Label text is small print, so ask for full-resolution image processing.
  return { type: 'input_image', image_url: dataUrl, detail: 'high' };
}

/** Structured-output models report refusals as a separate content part rather than text. */
function findRefusal(response: ModelResponse): string | null {
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content) {
      if (part.type === 'refusal') return part.refusal;
    }
  }
  return null;
}

const modelFieldConfidence = z.object({ score: z.number(), reason: z.string().nullable() });
const modelConfidence = z.object(
  Object.fromEntries(CONFIDENCE_FIELDS.map((field) => [field, modelFieldConfidence])) as Record<
    (typeof CONFIDENCE_FIELDS)[number],
    typeof modelFieldConfidence
  >,
);

/**
 * The model's per-field scores, held to 0–100. Unlike the data, they're read leniently: scores are
 * advisory, so missing or malformed ones mean "not scored" (null), never a failed extraction.
 */
function parseConfidence(value: unknown): ExtractionConfidence | null {
  const parsed = modelConfidence.safeParse(value);
  if (!parsed.success) return null;
  return Object.fromEntries(
    CONFIDENCE_FIELDS.map((field) => {
      const { score, reason } = parsed.data[field];
      const reasonText = reason?.trim();
      return [field, { score: Math.round(Math.min(100, Math.max(0, score))), reasons: reasonText ? [reasonText] : [] }];
    }),
  ) as ExtractionConfidence;
}
