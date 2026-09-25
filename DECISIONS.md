# Decisions

## Architecture in one breath

The browser asks the API for a signed URL, uploads the file **straight to storage**, then tells the API it's done. The API checks the file's real type from its first bytes and, **in one Postgres transaction**, marks the upload `queued` and inserts a job. A separate worker process pulls jobs, calls the LLM, validates the answer against our schema and stores it. The browser polls for status.

## Why a Postgres queue (pg-boss) rather than Redis or SQS

- **Transactional enqueue.** The queue lives in the same database as the `uploads` table, so "mark queued" and "create job" commit or roll back together. Without that we'd need an outbox table to avoid the two failure cases: a row stuck in `queued` with no job, or a job for a row that never got updated.
- **One less moving part.** We already run Postgres (Supabase). Redis would add a service to host, secure and monitor for no benefit at this scale.
- **Everything we need is built in:** `SKIP LOCKED` job claiming (any number of workers, each job to one worker), retry limits, exponential back-off with jitter, job expiry for crashed workers, and a dead-letter queue.
- **The trade-off:** a Postgres queue tops out at thousands of jobs a second, polls (2 s latency) rather than pushes, and shares load with the primary database. Our bottleneck is the LLM at tens of jobs a second, so that ceiling is far away. Past roughly 1k jobs/s, or if queue traffic started to contend with app queries, I'd move to SQS or Redis and add an outbox.
- **Rejected:** having the API call a worker endpoint directly. Jobs are lost if the worker is down, crashes mid-job are forgotten, and there's no back-pressure. It also wouldn't be a real queue.

## How LLM failures are handled

The LLM sits behind a `LabelExtractor` interface. Every failure becomes an `ExtractionError` carrying a code, a user-facing message and a **retryable** flag (see `server/src/extraction/errors.ts`).

| Retried (transient) | Not retried (permanent) |
|---|---|
| Timeout (90 s client timeout; the job's abort signal also cancels it) | Bad API key, no access or unknown model (401/403/404) |
| Rate limited (429) | Out of credit (429 `insufficient_quota`) |
| 5xx, network errors | File rejected by the model (400) |
| Malformed JSON, truncated output, schema mismatch | Refusal or content filter |
| Unknown errors (retrying is safe) | Valid answer with nothing label-like in it; file missing |

- **The queue owns retries, not the SDK** (`maxRetries: 0`). That gives one retry policy: 5 attempts, backing off about 15 s, 30 s, 60 s and 120 s with jitter. It survives restarts, and the user can see it. Between attempts the upload goes back to `queued` with the reason ("The AI service is rate-limiting requests. Retrying automatically."). The final failure says "Gave up after 5 attempts".
- **Output is never trusted.** Structured outputs constrain the model, and every response is still parsed with Zod. We store normalised, validated data or nothing.
- **Crashes and hangs.** A job still active after 180 s is expired and retried by pg-boss. If the *final* attempt dies, the job lands in the dead-letter queue, whose handler marks the upload failed, so nothing sits in `processing` forever.
- **Idempotency.** Every status change is a guarded `UPDATE … WHERE status IN (…)`, so duplicate deliveries, double clicks and races are no-ops.
- **Manual retry.** Users can retry failures that aren't caused by the file itself (e.g. after credit is topped up).

## 50,000 uploads at once

1. **Ingest.** Bytes never pass through our servers; storage absorbs them. The API does two small JSON requests per file and is stateless, so it scales horizontally. At that volume I'd add a batch endpoint that signs many URLs per request.
2. **Queueing.** 50k rows is a small table for Postgres. Jobs wait durably, and nothing is lost if workers are busy or down.
3. **Processing is bounded by the LLM's rate limit, not by us.** At 500 requests/minute, 50k files take about 100 minutes however many workers we run. So I'd size total concurrency (workers × `WORKER_CONCURRENCY`) to the rate limit, since more only generates 429s. I'd also add a shared token-bucket limiter so workers pace themselves instead of discovering the limit through errors.
4. **For bulk imports,** I'd route through OpenAI's Batch API (about half the cost, a separate higher quota, results within 24 h) and keep the realtime path for interactive uploads, using pg-boss priorities so interactive uploads jump the backlog.
5. **Supporting pieces:** keep per-process DB pools small behind Supabase's pooler, paginate the list (it's capped at 100 rows today), and push status changes (Supabase Realtime or SSE) instead of having every browser poll.

## Storage

We first considered S3, then preferred **Cloudflare R2**, which has a free tier and is S3-compatible, so the code is the same. Once we chose a Postgres queue on **Supabase**, we switched to **Supabase Storage**: one platform, one account and one set of keys for database, queue and files. Supabase also enforces the bucket's size and type limits itself, so a signed upload URL can't be used to push anything else. Storage sits behind a small `FileStorage` interface, so moving to S3/R2 later is one new file.

## Frontend

The UI uses the same stack as SupplyScope's app: Tailwind v4 and shadcn/ui on Radix, with Lucide icons and Sonner toasts. I found this by inspecting app.supplyscope.io's public login page and its assets. Anyone on their team can read and extend it without learning a new component library.

It's also styled with their brand, taken from supplyscope.io and their product screenshots:
- **Colours:** warm off-white `#F6F5F3` background, near-black `#1B1B1B` buttons, indigo `#5048E5` reserved for AI features ("BETA" pill, "Retry extraction", AI sparkles) and green `#027A48` for validated data.
- **Layout:** a dark sidebar shell.
- **Detail view:** modelled on their compliance screen, with a "Core information" card, a pastel card for allergens, and the source document alongside.
- **Not copied:** their logo or product name (the deployed app is public, and it shouldn't pass as an official SupplyScope product) and their display typeface (Labil Grotesk is commercially licensed). Inter, which their app itself uses, stands in with tight heading tracking.
- **Desktop only:** there's no mobile layout. It's a desktop operations tool, and supporting phones would have added complexity for little benefit.

## Other trade-offs and things deliberately left out

- **No authentication or multi-tenancy:** everyone shares one list. This is the first thing to add before real use, along with per-user quotas.
- **Polling, not push:** simple and robust. It polls only while something is in progress, and pauses in background tabs.
- **No clean-up jobs:** uploads abandoned mid-upload stay hidden in `uploading`, and files rejected on content stay in the bucket. A scheduled job would delete both.
- **Rate limits are handled with back-off,** not by honouring `Retry-After` precisely.
- **Not supported:** HEIC photos (they'd need converting first), and PDFs are limited by size, not page count.
- **Allergens:** declared allergens only. "May contain" warnings are deliberately excluded.
- **No build step on the server:** Node runs the TypeScript directly (type stripping). Only the web app is bundled.
