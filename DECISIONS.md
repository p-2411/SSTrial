# Decisions

**In short:** the browser uploads each file straight to storage; the API records the upload and, in the same Postgres transaction, queues a job. A separate worker calls the LLM, validates the answer against our schema and stores it. Browsers see each change live.

## 50,000 uploads arriving at once

- **Ingest never touches our servers.** Files go straight to Supabase Storage with signed URLs; the API only handles two small, stateless requests per file, so it scales horizontally.
- **The queue absorbs the burst.** 50,000 jobs is a small Postgres table. They wait durably, and nothing is lost if workers are busy or restarting.
- **Throughput is set by the LLM's rate limit, not by us.** At 500 requests a minute, 50,000 labels take about 100 minutes however many workers run. A token bucket shared by all workers paces them to that limit. Identical files are recognised by their SHA-256 and read once.
- **For bulk imports** I'd use OpenAI's Batch API (about half the cost, a separate quota), with queue priorities so people's own uploads skip the backlog.

## Why a Postgres queue (pg-boss)

Mainly **YAGNI**. We already run Postgres on Supabase, and a Postgres queue handles thousands of jobs a second, far more than the LLM lets us process (tens a second). Redis or SQS would add a service to run and secure, optimising for a scale this product doesn't have.

It also gives us, for free:
- **Transactional enqueue.** Marking an upload `queued` and creating its job commit together, so there's never a queued upload without a job. Redis or SQS would need an outbox table for that.
- **The hard parts:** `SKIP LOCKED` claiming (each job to exactly one worker), retries with back-off, expiry for crashed workers, and a dead-letter queue.

**Trade-off:** it polls (about 2 s latency) and shares load with the main database. Past roughly 1,000 jobs a second, I'd move to SQS with an outbox.

## LLM failures and retries

- **Every failure becomes a code, and the code decides.** Timeouts, rate limits, 5xx and malformed output are retried. A bad key, no credit, a refusal, an unreadable file, or no label in the image are not: retrying can't help. Users see a plain message for the code.
- **The queue owns retries, not the SDK.** One policy: 5 attempts, backing off about 15 s, 30 s, 60 s and 120 s with jitter. The upload shows "Retrying" and why.
- **Rate limits are respected together.** On a 429 with `Retry-After`, the shared bucket pauses every worker for that long.
- **Output is never trusted.** Every answer is validated with Zod before it's stored: valid data or nothing.
- **Crashed or hung workers.** If a job's heartbeats stop, another worker takes it within about a minute. A claim token stops the replaced worker overwriting its successor, and if the last attempt dies, a dead-letter handler marks the upload failed, so nothing stays "processing" forever.
- **Manual retry** is offered for failures the file didn't cause, such as after credit is topped up.

## Trade-offs

- **Supabase Storage over S3 or R2.** One platform for database, queue and files was simpler. Storage sits behind an interface, so switching is one file.
- **Confidence from the model, checked by code.** The model scores each field in the same call; extracting twice and comparing would measure doubt better, at double the cost. Its scores aren't calibrated, so plain checks lower any field the rest of the data contradicts, and people can mark fields as checked.
- **SupplyScope's own UI stack** (Tailwind v4, shadcn/ui), so their team could extend it. Desktop only.
- **Left out for now:** team management (accounts come from a script), CI, HEIC photos and rollback migrations. A label can occasionally be read twice if a worker loses the database mid-call; the claim token makes the second read harmless.
