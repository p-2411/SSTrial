# Decisions

## Architecture in one breath

The browser asks the API for a signed URL, uploads the file **straight to storage**, then tells the API it's done. The API checks the file's real type from its first bytes and, **in one Postgres transaction**, marks the upload `queued` and inserts a job. A separate worker process pulls jobs, calls the LLM, validates the answer against our schema and stores it. A database trigger announces each change, and the API pushes it to browsers over server-sent events.

## Why a Postgres queue (pg-boss) rather than Redis or SQS

- **Transactional enqueue.** The queue lives in the same database as the `uploads` table, so "mark queued" and "create job" commit or roll back together. Without that we'd need an outbox table to avoid the two failure cases: a row stuck in `queued` with no job, or a job for a row that never got updated.
- **One less moving part.** We already run Postgres (Supabase). Redis would add a service to host, secure and monitor for no benefit at this scale.
- **Everything we need is built in:** `SKIP LOCKED` job claiming (any number of workers, each job to one worker), retry limits, exponential back-off with jitter, job expiry for crashed workers, and a dead-letter queue.
- **The trade-off:** a Postgres queue tops out at thousands of jobs a second, polls (2 s latency) rather than pushes, and shares load with the primary database. Our bottleneck is the LLM at tens of jobs a second, so that ceiling is far away. Past roughly 1k jobs/s, or if queue traffic started to contend with app queries, I'd move to SQS or Redis and add an outbox.
- **Rejected:** having the API call a worker endpoint directly. Jobs are lost if the worker is down, crashes mid-job are forgotten, and there's no back-pressure. It also wouldn't be a real queue.

## How LLM failures are handled

The LLM sits behind a `LabelExtractor` interface. Every failure becomes an `ExtractionError` carrying a code and a **retryable** flag (see `server/src/extraction/errors.ts`). Only the code is stored; the message users see comes from one catalogue in `shared`, so rewording never touches data.

| Retried (transient) | Not retried (permanent) |
|---|---|
| Timeout (90 s client timeout; the job's abort signal also cancels it) | Bad API key, no access or unknown model (401/403/404) |
| Rate limited (429) | Out of credit (429 `insufficient_quota`) |
| 5xx, network errors | File rejected by the model (400) |
| Malformed JSON, truncated output, schema mismatch | Refusal or content filter |
| Unknown errors (retrying is safe) | Valid answer with nothing label-like in it; file missing |

- **The queue owns retries, not the SDK** (`maxRetries: 0`). That gives one retry policy: 5 attempts, backing off about 15 s, 30 s, 60 s and 120 s with jitter. It survives restarts, and the user can see it. Between attempts the upload goes back to `queued` with the reason ("The AI service is rate-limiting requests. Retrying automatically."). Attempt counts stay in the logs; users only see the reason.
- **Rate limits are shared and honoured.** All workers draw from one token bucket in Postgres (`OPENAI_REQUESTS_PER_MINUTE`). When OpenAI answers 429 with `Retry-After` / `retry-after-ms`, the bucket pauses for that long, so every worker backs off together.
- **Output is never trusted.** Structured outputs constrain the model, and every response is still parsed with Zod. We store normalised, validated data or nothing.
- **Crashes and hangs.** Workers heartbeat every 15 s while processing. If the heartbeats stop (the worker died or lost the database), pg-boss hands the job to another worker within about a minute; a job still active after 180 s is expired regardless. If the *final* attempt dies, the job lands in the dead-letter queue, whose handler marks the upload failed, so nothing sits in `processing` forever.
- **One writer per upload.** Each attempt gets a fresh claim token, and saving a result, scheduling a retry or failing the upload only succeed with the current one. A worker whose job was handed on can't overwrite anything when it eventually finishes; it stands down.
- **Idempotency.** Every status change is a guarded `UPDATE … WHERE status IN (…)`, so duplicate deliveries, double clicks and races are no-ops.
- **Manual retry.** Users can retry failures that aren't caused by the file itself (e.g. after credit is topped up).

## 50,000 uploads at once

1. **Ingest.** Bytes never pass through our servers; storage absorbs them. The API does two small JSON requests per file and is stateless, so it scales horizontally. At that volume I'd add a batch endpoint that signs many URLs per request.
2. **Queueing.** 50k rows is a small table for Postgres. Jobs wait durably, and nothing is lost if workers are busy or down.
3. **Processing is bounded by the LLM's rate limit, not by us.** At 500 requests/minute, 50k files take about 100 minutes however many workers we run. The shared token bucket paces all workers to that rate, so adding workers beyond it gains nothing but doesn't cause 429 storms either. Identical files are recognised by their SHA-256 and processed once.
4. **For bulk imports,** I'd route through OpenAI's Batch API (about half the cost, a separate higher quota, results within 24 h) and keep the realtime path for interactive uploads, using pg-boss priorities so interactive uploads jump the backlog.
5. **Supporting pieces:** per-process DB pools stay small behind Supabase's pooler. The list is filtered, counted and paginated by the server (keyset cursor), and status changes are pushed to browsers rather than polled. The System status page and its alerts show a backlog building before users notice.

## Every upload reaches a final state

- **Nothing to clean up.** Creating an upload also schedules a one-off *finalise* job for just after its signed URL expires, in the same transaction. If the browser confirmed, the job does nothing. If the file arrived but the tab closed, the job confirms it. If nothing arrived, the upload is discarded. There's no periodic sweeper.
- **Rejected files aren't kept.** If the bytes aren't a supported type, the file and the upload are deleted, and the browser shows the reason on its own row with "Try again".
- **Unreadable results are surfaced.** A saved result that no longer fits the schema is flagged and can be run again, not shown as blank.

## Monitoring

- **Health checks:** `GET /api/health` on the API and on the worker checks the database, the queue and (on the worker) its job loop. It answers 503 naming what failed, and Railway uses it on deploy.
- **Alerts:** a once-a-minute monitor in the worker records a heartbeat and opens or resolves alerts in `ops_alerts`: the AI service refusing every request, a stalled queue, a backlog, stuck processing, a high failure rate, and crashed attempts. Only opening and resolving are logged.
- **Where to look:** the System status page (`/status`) and `GET /api/ops`. The workers' heartbeat covers the one failure a worker can't report itself: no worker running.

## Storage

We first considered S3, then preferred **Cloudflare R2**, which has a free tier and is S3-compatible, so the code is the same. Once we chose a Postgres queue on **Supabase**, we switched to **Supabase Storage**: one platform, one account and one set of keys for database, queue and files. Supabase also enforces the bucket's size and type limits itself, so a signed upload URL can't be used to push anything else. Storage sits behind a small `FileStorage` interface, so moving to S3/R2 later is one new file.

## Frontend

The UI uses the same stack as SupplyScope's app: Tailwind v4 and shadcn/ui on Radix, with Lucide icons and Sonner toasts. I found this by inspecting app.supplyscope.io's public login page and its assets. Anyone on their team can read and extend it without learning a new component library.

It's also styled with their brand, taken from supplyscope.io and their product screenshots:
- **Colours:** warm off-white `#F6F5F3` background, near-black `#1B1B1B` buttons, indigo `#5048E5` reserved for AI features ("BETA" pill, "Retry extraction", AI sparkles) and green `#027A48` for validated data.
- **Layout:** a dark sidebar shell. The sidebar holds destinations only (today just Uploads); the status filter is a tab row in the list's own header, because it narrows one panel rather than taking you somewhere new.
- **Detail view:** opens as a panel that slides in beside the list and narrows it, rather than covering it, so the main page is just "add files, see results" and you can move between uploads by clicking the next row. The URL (`/uploads/:id`) still drives it, so links, refresh and the back button work. Inside, it's modelled on their compliance screen: a "Core information" card with verified values in green, then the source document to check them against.
- **Not copied:** their logo or product name (the deployed app is public, and it shouldn't pass as an official SupplyScope product) and their display typeface (Labil Grotesk is commercially licensed). Inter, which their app itself uses, stands in with tight heading tracking.
- **Desktop only:** there's no mobile layout. It's a desktop operations tool, and supporting phones would have added complexity for little benefit.

## Other trade-offs and things deliberately left out

- **No authentication or multi-tenancy:** everyone shares one list. This is the first thing to add before real use, along with per-user quotas.
- **A double LLM call is still possible, just rarer.** If a worker loses the database mid-call, its job is handed on and the label is read twice. The claim token makes the second read harmless, and heartbeats make the handover prompt, but an in-flight LLM call can't be taken back.
- **Migrations only go forward.** There are no down scripts; one-off data changes are committed scripts (`server/scripts/`), not ad-hoc SQL.
- **No CI.** Tests and deploys are run by hand.
- **Not supported:** HEIC photos (they'd need converting first), and PDFs are limited by size, not page count.
- **Allergens:** declared allergens only. "May contain" warnings are deliberately excluded.
- **No build step on the server:** Node runs the TypeScript directly (type stripping). Only the web app is bundled.
