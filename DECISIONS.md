# Decisions

## Architecture in one breath

The browser asks the API for a signed URL, uploads the file **straight to storage**, then tells the API it's done. The API checks the file's real type from its first bytes and, **in one Postgres transaction**, marks the upload `queued` and inserts a job. A separate worker process pulls jobs, calls the LLM, validates the answer against our schema and stores it. A database trigger announces each change, and the API pushes it to browsers over server-sent events. Each step is also recorded in an activity log that anyone can browse.

## Why a Postgres queue (pg-boss) rather than Redis or SQS

- **Transactional enqueue.** The queue lives in the same database as the `uploads` table, so "mark queued" and "create job" commit or roll back together. Without that we'd need an outbox table to avoid the two failure cases: a row stuck in `queued` with no job, or a job for a row that never got updated.
- **One less moving part.** We already run Postgres (Supabase). Redis would add a service to host, secure and monitor for no benefit at this scale.
- **Everything we need is built in:** `SKIP LOCKED` job claiming (any number of workers, each job to one worker), retry limits, exponential back-off with jitter, job expiry for crashed workers, and a dead-letter queue.
- **The trade-off:** a Postgres queue tops out at thousands of jobs a second, polls (2 s latency) rather than pushes, and shares load with the primary database. Our bottleneck is the LLM at tens of jobs a second, so that ceiling is far away. Past roughly 1k jobs/s, or if queue traffic started to contend with app queries, I'd move to SQS or Redis and add an outbox.
- **Rejected:** having the API call a worker endpoint directly. Jobs are lost if the worker is down, crashes mid-job are forgotten, and there's no back-pressure. It also wouldn't be a real queue.

## How LLM failures are handled

The LLM sits behind a `LabelExtractor` interface. Every failure becomes an `ExtractionError` carrying a code, and the code decides whether it's **retryable** (see `server/src/extraction/errors.ts`). Provider-specific errors are mapped in the OpenAI implementation, so the worker never sees the SDK. Only the code is stored; the message users see comes from one catalogue in `shared`, so rewording never touches data.

| Retried (transient) | Not retried (permanent) |
|---|---|
| Timeout (90 s client timeout; the job's abort signal also cancels it) | Bad API key, no access or unknown model (401/403/404) |
| Rate limited (429) | Out of credit (429 `insufficient_quota`) |
| 5xx, network errors | File rejected by the model (400) |
| Malformed JSON, truncated output, schema mismatch | Refusal or content filter |
| Unknown errors (retrying is safe) | Valid answer with nothing label-like in it; file missing |

- **The queue owns retries, not the SDK** (`maxRetries: 0`). That gives one retry policy: 5 attempts, backing off about 15 s, 30 s, 60 s and 120 s with jitter. The policy, which failures are worth retrying, and the retry-or-stop decision are plain rules in `server/src/extraction/retry-policy.ts`; the pg-boss settings are derived from them. It survives restarts, and the user can see it. Between attempts the upload goes back to `queued` with the reason ("The AI service is rate-limiting requests. Retrying automatically."). Attempt counts stay in the logs; users only see the reason.
- **Rate limits are shared and honoured.** All workers draw from one token bucket in Postgres (`OPENAI_REQUESTS_PER_MINUTE`). When OpenAI answers 429 with `Retry-After` / `retry-after-ms`, the bucket pauses for that long, so every worker backs off together.
- **Output is never trusted.** Structured outputs constrain the model, and every response is still parsed with Zod. We store normalised, validated data or nothing.
- **Crashes and hangs.** Workers heartbeat every 15 s while processing. If the heartbeats stop (the worker died or lost the database), pg-boss hands the job to another worker within about a minute; a job still active after 180 s is expired regardless. If the *final* attempt dies, the job lands in the dead-letter queue, whose handler marks the upload failed, so nothing sits in `processing` forever.
- **One writer per upload.** Each attempt gets a fresh claim token, and saving a result, scheduling a retry or failing the upload only succeed with the current one. A worker whose job was handed on can't overwrite anything when it eventually finishes; it stands down.
- **Idempotency.** Every status change is a guarded `UPDATE … WHERE status = any(…)`, so duplicate deliveries, double clicks and races are no-ops. The allowed changes are declared once, in `shared/src/lifecycle.ts`; the store builds its guards from that table, and an integration test tries every change from every status against real Postgres.
- **Manual retry.** Users can retry failures that aren't caused by the file itself (e.g. after credit is topped up).

## Confidence scores

- **From the model, in the same call.** It scores each field 0–100 and gives a reason for anything below 85 ("partly hidden by a fold"). That costs a few output tokens rather than a second call. Alternatives considered: token log-probabilities (not available for the GPT-5 family or reasoning models), extracting twice and comparing (a real measure of disagreement, but double the cost and time), and a separate verifier model (TypeSafe's Jev returns calibrated probabilities, but takes text only, and our input is images).
- **Plain checks correct it.** A model's own score ranks fields well but isn't a calibrated probability, and models are most overconfident exactly where they're wrong. So `applyConfidenceChecks` caps a field at 60 where the data contradicts itself: the net amount isn't in its own printed text, a declared allergen is in no ingredient, or the percentages add up to more than 100%. Checks only lower scores and add their own reason.
- **Bands, not decimals.** The UI works in three bands (85+ fine, 60–84 check, below 60 low), because the difference between 88 and 92 means nothing. An upload's score is its least certain field: one bad field is what makes a label need review, and an average would hide it.
- **Advisory, so lenient.** The label data is validated strictly and retried if malformed; the scores aren't worth a retry. Missing or malformed scores are stored as "not scored", and uploads from before scoring existed simply show none. Scores live in their own column, apart from the result that's exported.

## 50,000 uploads at once

1. **Ingest.** Bytes never pass through our servers; storage absorbs them. The API does two small JSON requests per file and is stateless, so it scales horizontally. At that volume I'd add a batch endpoint that signs many URLs per request.
2. **Queueing.** 50k rows is a small table for Postgres. Jobs wait durably, and nothing is lost if workers are busy or down.
3. **Processing is bounded by the LLM's rate limit, not by us.** At 500 requests/minute, 50k files take about 100 minutes however many workers we run. The shared token bucket paces all workers to that rate, so adding workers beyond it gains nothing but doesn't cause 429 storms either. Identical files are recognised by their SHA-256 and processed once.
4. **For bulk imports,** I'd route through OpenAI's Batch API (about half the cost, a separate higher quota, results within 24 h) and keep the realtime path for interactive uploads, using pg-boss priorities so interactive uploads jump the backlog.
5. **Supporting pieces:** per-process DB pools stay small behind Supabase's pooler. The list is filtered, counted and paginated by the server (keyset cursor), and status changes are pushed to browsers rather than polled. The System status page shows a backlog building before users notice.

## Every upload reaches a final state

- **Nothing to clean up.** Creating an upload also schedules a one-off *finalise* job for just after its signed URL expires, in the same transaction. If the browser confirms (or its file is rejected), the job is cancelled in that same transaction, so it never runs. If the file arrived but the tab closed, the job confirms it. If nothing arrived, the upload is discarded. There's no periodic sweeper.
- **Rejected files aren't kept.** If the bytes aren't a supported type, the file and the upload are deleted, and the browser shows the reason on its own row with "Try again".
- **Unreadable results are surfaced.** A saved result that no longer fits the schema is flagged and can be run again, not shown as blank.

## Monitoring

- **Health checks:** `GET /api/health` on the API and on the worker checks the database, the queue and (on the worker) its job loop. It answers 503 naming what failed, and Railway uses it on deploy.
- **Worker heartbeat:** a once-a-minute job in the worker records that it's running. That covers the one failure a worker can't report itself: no worker running. The same job prunes the activity log.
- **Where to look:** the System status page (`/status`) and `GET /api/ops` for the state of things now: the queue, the worker, health checks, the last 24 hours and failures by reason. The activity log (`/logs`) shows what happened, and when.
- **No alerts, deliberately.** An earlier version opened and resolved alerts (AI service refusing requests, stalled queue, backlog, high failure rate, crashed attempts). They only ever showed inside the app, where the same facts are already on the status page and in the activity log, so they were removed. Alerting worth having would notify someone (email, Slack, a pager) from an uptime check on `/api/health` and the host's log search. That's the step to add before real use.

## Activity log

An `events` table records what happened to each upload (created, identical to an earlier file, queued, rejected, discarded, retried by hand, each extraction attempt started, completed, scheduled for retry, failed or abandoned) and to the system (rate-limit pauses, process starts). The Logs page (`/logs`) shows it newest first, grouped by day. One menu narrows it to any mix of event types, and it can be narrowed to one upload. Each type has a fixed level, set once in the shared catalogue ("Extraction failed" is always an error), so there's no separate level filter: "Warnings and errors" and "Errors only" are shortcuts that tick the matching types. The filters are kept in the URL.

- **A table, not the stdout logs.** The processes still log to stdout (pino) for debugging: stack traces, raw provider errors. But those can't be queried per upload from the app, and they're only as good as the host's log search. Events are one readable sentence each, plus structured `data` (error code, attempt, duration, file name), so they work for the person running the system, not only for a developer.
- **Written by the application, not by triggers.** A trigger on `uploads` would catch every status change atomically, but it can't know *why*: which attempt, whether the error is worth retrying, how long the AI took, that a result was reused, that every worker paused. The use cases and the worker know, so they record events through a small `EventLog` interface, and every message is worded in one file (`server/src/logs/events.ts`).
- **Best-effort, after the change, never in its transaction.** A log write can't fail or slow down an upload: a failed insert is reported to stdout and swallowed. The cost is that an event can be missing if a process dies between a change and its event. For a history meant for people, that's the right side to err on. Recording in the same transaction would turn a logging hiccup into a failed upload.
- **History outlives the upload.** `upload_id` has no foreign key, because rejected and discarded uploads are deleted, and their events are exactly the ones worth keeping. Events carry the file name for the same reason.
- **Scale.** An upload writes four events when all goes well, and a few more for each retry, so 50,000 uploads add 200,000 to 300,000 rows. Pages use a keyset cursor on the ID. Per-upload and per-type lookups have their own indexes; the event types worth filtering to (failures, retries, rejections) are rare, so a filtered page reads few rows. Events are kept for 30 days and pruned by the once-a-minute monitor, so each run deletes about a minute's worth, found through a BRIN index on the timestamp. Past a few million rows a day, I'd partition by day and drop old partitions instead, or send events to a log store.
- **Live.** A statement-level trigger on `events` sends a NOTIFY with no payload. The API forwards it as a `log` server-sent event, and the page refetches its newest events. With no payload there's nothing to parse or trust, and a burst of inserts collapses into one refresh in the browser.

## Storage

We first considered S3, then preferred **Cloudflare R2**, which has a free tier and is S3-compatible, so the code is the same. Once we chose a Postgres queue on **Supabase**, we switched to **Supabase Storage**: one platform, one account and one set of keys for database, queue and files. Supabase also enforces the bucket's size and type limits itself, so a signed upload URL can't be used to push anything else. Storage sits behind a small `FileStorage` interface, so moving to S3/R2 later is one new file.

## Frontend

The UI uses the same stack as SupplyScope's app: Tailwind v4 and shadcn/ui on Radix, with Lucide icons and Sonner toasts. I found this by inspecting app.supplyscope.io's public login page and its assets. Anyone on their team can read and extend it without learning a new component library.

It's also styled with their brand, taken from supplyscope.io and their product screenshots:
- **Colours:** warm off-white `#F6F5F3` background, near-black `#1B1B1B` buttons, indigo `#5048E5` reserved for AI features ("BETA" pill, "Retry extraction", AI sparkles) and green `#027A48` for validated data.
- **Layout:** a dark sidebar shell. The sidebar holds destinations only (Uploads, and for admins System status and the Activity log), then who is signed in; the status filter is a tab row in the list's own header, because it narrows one panel rather than taking you somewhere new.
- **Detail view:** opens as a panel that slides in beside the list and narrows it, rather than covering it, so the main page is just "add files, see results" and you can move between uploads by clicking the next row. The URL (`/uploads/:id`) still drives it, so links, refresh and the back button work. Inside, it's modelled on their compliance screen: a "Core information" card with verified values in green, then the source document to check them against.
- **Not copied:** their logo or product name (the deployed app is public, and it shouldn't pass as an official SupplyScope product) and their display typeface (Labil Grotesk is commercially licensed). Inter, which their app itself uses, stands in with tight heading tracking.
- **Desktop only:** there's no mobile layout. It's a desktop operations tool, and supporting phones would have added complexity for little benefit.

## Sign-in and roles

- **Accounts come from a script, not sign-up or invites.** It's the smallest thing that shows how access is managed. Invites would need an email provider (Supabase's built-in one only emails the project's own team), and public sign-up would let anyone spend the OpenAI credit. Supabase Auth holds the accounts and passwords; the `members` table says who has access and as what.
- **Two roles.** Members do the work: upload, review, export. Admins can also see how the system is running (System status, the Activity log). The API enforces it with `requireRole`; the UI only hides what the API would refuse anyway.
- **Roles live in a table, not in the token.** The API looks the member up on every request (one primary-key read), so removing someone or changing their role applies immediately instead of when their token next refreshes, up to an hour later.
- **The token travels in a header, never in a URL,** where it would end up in server and proxy logs. That's why live updates read the event stream with `fetch` (the browser's `EventSource` can't send headers) and exports download through `fetch` rather than a plain link.
- **Only Supabase's auth client ships to the browser** (`@supabase/auth-js`), not all of supabase-js: the browser never talks to the database or storage directly.

## Other trade-offs and things deliberately left out

- **One workspace, no team management:** everyone signed in shares one list, and accounts come from a script. Before real use: invites through an email provider, password reset, per-user quotas, and separate workspaces if several companies share it.
- **A double LLM call is still possible, just rarer.** If a worker loses the database mid-call, its job is handed on and the label is read twice. The claim token makes the second read harmless, and heartbeats make the handover prompt, but an in-flight LLM call can't be taken back.
- **Migrations only go forward.** There are no down scripts; one-off data changes are committed scripts (`server/scripts/`), not ad-hoc SQL.
- **No CI.** Tests and deploys are run by hand.
- **Not supported:** HEIC photos (they'd need converting first), and PDFs are limited by size, not page count.
- **Allergens:** declared allergens only. "May contain" warnings are deliberately excluded.
- **No build step on the server:** Node runs the TypeScript directly (type stripping). Only the web app is bundled.
