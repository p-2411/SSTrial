import type postgres from 'postgres';
import { ExtractionError } from './errors.ts';

/**
 * Keeps every worker process, together, under the LLM provider's request rate.
 *
 * A token bucket held in one Postgres row: each request takes a token, tokens refill at the
 * allowed rate, and the row lock serialises the accounting across processes and machines. When the
 * provider says "slow down" (429 with Retry-After), the bucket is paused for that long, so all
 * workers back off together instead of each discovering the limit through its own errors.
 */
export interface RateLimiter {
  /**
   * Waits until a request may be made. If that would take longer than the limiter's maximum wait,
   * throws a retryable LLM_RATE_LIMITED error instead, so the job returns to the queue (with
   * back-off) rather than holding a worker slot.
   */
  acquire(signal?: AbortSignal): Promise<void>;
  /** Stops every worker making requests for `ms` — the provider asked us to back off. */
  pauseFor(ms: number): Promise<void>;
}

export interface RateLimiterOptions {
  /** Which bucket, e.g. "openai". */
  key: string;
  requestsPerMinute: number;
  /** Longest a single acquire() waits before giving the job back to the queue. */
  maxWaitMs?: number;
}

/** Our own limiter had no slot soon enough — not the provider refusing us, so no pause is needed. */
export class RateLimitWaitTooLong extends ExtractionError {
  override name = 'RateLimitWaitTooLong';
  constructor(waitMs: number) {
    super('LLM_RATE_LIMITED', true, `Shared rate limit: next slot in ${Math.round(waitMs)}ms`);
  }
}

export function createPostgresRateLimiter(sql: postgres.Sql, options: RateLimiterOptions): RateLimiter {
  const perSecond = options.requestsPerMinute / 60;
  // Allow a short burst (about 5 seconds' worth), so an idle system can start several jobs at once.
  const capacity = Math.max(1, Math.round(perSecond * 5));
  const maxWaitMs = options.maxWaitMs ?? 30_000;
  const { key } = options;
  let ensured: Promise<unknown> | undefined;

  // Tokens available right now: what was left, plus what has refilled since, capped at capacity.
  const available = sql`least(${capacity}::float8, tokens + extract(epoch from clock_timestamp() - refilled_at) * ${perSecond}::float8)`;

  return {
    async acquire(signal) {
      ensured ??= sql`insert into llm_rate_limits (key, tokens) values (${key}, ${capacity}) on conflict (key) do nothing`;
      await ensured;
      const started = Date.now();

      for (;;) {
        signal?.throwIfAborted();
        const taken = await sql`
          update llm_rate_limits
          set tokens = ${available} - 1, refilled_at = clock_timestamp()
          where key = ${key}
            and (paused_until is null or paused_until <= clock_timestamp())
            and ${available} >= 1
          returning 1`;
        if (taken.length > 0) return;

        // No token yet: wait for the pause to end or the next token to refill, whichever is later.
        const [state] = await sql`
          select greatest(
            coalesce(extract(epoch from paused_until - clock_timestamp()), 0),
            (1 - ${available}) / ${perSecond}::float8
          ) * 1000 as wait_ms
          from llm_rate_limits where key = ${key}`;
        const waitMs = Math.max(50, Number(state?.wait_ms ?? 1000));
        if (Date.now() - started + waitMs > maxWaitMs) {
          throw new RateLimitWaitTooLong(waitMs);
        }
        // A little jitter so waiting workers don't all retry at the same instant.
        await sleep(waitMs + Math.random() * 100, signal);
      }
    },

    async pauseFor(ms) {
      await sql`
        insert into llm_rate_limits (key, tokens, paused_until)
        values (${key}, 0, clock_timestamp() + make_interval(secs => ${ms / 1000}))
        on conflict (key) do update
        set tokens = 0,
            refilled_at = clock_timestamp(),
            paused_until = greatest(coalesce(llm_rate_limits.paused_until, clock_timestamp()), excluded.paused_until)`;
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
