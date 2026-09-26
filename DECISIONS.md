# Decisions

## 50,000 uploads arriving at once

- **Ingest never touches our servers.** Files go straight to Supabase Storage with signed URLs; the API handles two small, stateless requests per file, so it scales horizontally. One person can have at most 200 under way.
- **The queue absorbs the burst.** 50,000 jobs is a small Postgres table. They wait durably, and nothing is lost if workers are busy or restarting.
- **Throughput is set by the LLM's rate limit, not by us.** At 500 requests a minute (`OPENAI_REQUESTS_PER_MINUTE`), 50,000 labels take about 100 minutes however many workers run. A token bucket shared by all workers paces them to that limit, and identical files (same SHA-256) are read once.
- **For bulk imports** I'd use OpenAI's Batch API (about half the cost, a separate quota), with queue priorities so people's own uploads skip the backlog.

## Why a Postgres queue (pg-boss)

Mainly **YAGNI**. We already run Postgres, and a Postgres queue handles thousands of jobs a second, far more than the LLM lets us process (tens a second). Redis or SQS would add a service to run and secure, for a scale this product doesn't have. It also gives us, for free:
- **Transactional enqueue.** Marking an upload `queued` and creating its job commit together, so there's never a queued upload without a job. Redis or SQS would need an outbox table.
- **The hard parts:** `SKIP LOCKED` claiming, retries with back-off, expiry for crashed workers, and a dead-letter queue.

**Trade-off:** it polls (about 2 s latency) and shares load with the main database. Past roughly 1,000 jobs a second, I'd move to SQS with an outbox.

## LLM failures and retries

- **Every failure becomes a code, and the code decides.** Timeouts, rate limits, 5xx and malformed output are retried. A bad key, no credit, a refusal, an unreadable file or no label are not: retrying can't help. Users see a plain message for the code.
- **The queue owns retries, not the SDK.** 5 attempts, backing off about 15 s, 30 s, 60 s and 120 s with jitter; the upload shows "Retrying" and why. On a 429, the shared bucket pauses every worker for the `Retry-After`.
- **Output is never trusted.** Every answer is validated with Zod before it's stored: valid data or nothing.
- **Crashed or hung workers.** If a job's heartbeats stop, another worker takes it within about a minute. A claim token stops the old attempt overwriting the new one, and a dead-letter handler fails an upload whose last attempt died, so nothing stays "processing" forever.
- **Manual retry** is offered for any failure but a missing file, such as after credit is topped up.

## Performance

- **The database searches, filters and pages every list**, with keyset cursors, so a deep page is as quick as the first. Partial indexes match each list's filter and order, and searches use trigram indexes (checked with EXPLAIN on 60,000 products).
- **Bulk actions take one pass:** deleting 100 products is one read, one storage request and one transaction.
- **Pushed, not polled.** Server-sent events say what changed; polling is only the fallback.
- **Less work in the browser.** Event details load when opened, off-screen rows skip layout, and rarely used pages load on first use.

## Trade-offs

- **Supabase Storage over S3 or R2.** One platform for database, queue and files was simpler, and storage sits behind an interface, so switching is one file.
- **Confidence from the model, checked by code.** The model scores each field in the same call; extracting twice and comparing would measure doubt better, at double the cost. Its scores aren't calibrated, so plain checks lower any field the data contradicts.
- **Review before Products.** Products is the record others rely on, so anything the model was unsure of must be checked by a person first. The price is a step per upload, kept small by submitting everything ready at once.
- **One file, one product.** A product can't be built from several files (a pack's front and back). Adding many products in one batch is the more common need, and allowing both would make uploading harder for everyone.
- **SupplyScope's own UI stack** (Tailwind v4, shadcn/ui), so it feels like a SupplyScope product. Desktop only.
- **Left out for now:** team management (accounts come from a script), CI, HEIC photos and rollback migrations. A label can occasionally be read twice if a worker loses the database mid-call; the claim token makes the second read harmless.
