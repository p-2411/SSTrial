import { z } from 'zod';

/**
 * Environment configuration, validated once at start-up so a missing or malformed variable fails
 * fast with a clear message instead of surfacing later as a confusing runtime error.
 *
 * The API and the worker each load only what they need: the web-facing API process never holds
 * the OpenAI key, and the worker never needs an HTTP port.
 */

const shared = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Postgres connection string. On Supabase use the *session* pooler URL (IPv4, port 5432). */
  DATABASE_URL: z.url(),
  /** Max connections per process for app queries. pg-boss keeps its own small pool on top. */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),

  SUPABASE_URL: z.url(),
  /** Server-side Supabase key (sb_secret_… or the legacy service_role JWT). Never sent to browsers. */
  SUPABASE_SECRET_KEY: z.string().min(1),
  /** Only when browsers must reach Supabase at a different address than the server does (Docker). */
  SUPABASE_PUBLIC_URL: z.url().optional(),
  STORAGE_BUCKET: z.string().min(1).default('labels'),
};

const apiSchema = z.object({
  ...shared,
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Directory of the built web app (web/dist). When set, the API also serves the UI. */
  WEB_DIST_DIR: z.string().optional(),
});

const workerSchema = z.object({
  ...shared,
  /** The worker serves only GET /api/health, so the host can check it's alive. */
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3001),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default('gpt-5.4-mini'),
  /** Per-request timeout for the LLM call. Must stay well under the job's expiry (see queue.ts). */
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  /** Requests per minute allowed to the LLM across *all* workers together (shared rate limiter). */
  OPENAI_REQUESTS_PER_MINUTE: z.coerce.number().positive().default(120),
  /** How many jobs this worker process handles at once. Scale out with more processes. */
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
});

export type ApiConfig = z.infer<typeof apiSchema>;
export type WorkerConfig = z.infer<typeof workerSchema>;

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return parse(apiSchema, env);
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return parse(workerSchema, env);
}

function parse<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    // List every problem at once; never echo values, since some of them are secrets.
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}\nSee server/.env.example.`);
  }
  return result.data;
}
