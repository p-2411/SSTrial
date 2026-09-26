# Decisions

## 50,000 uploads arriving at once

- **Ingest never touches our servers.** Files go straight to Supabase Storage with signed URLs; the API only handles two small, stateless requests per file, so it scales horizontally (one person can have at most 200 under way, in batches of up to 50).
- **The queue absorbs the burst.** 50,000 jobs is a small Postgres table. They wait durably, and nothing is lost if workers are busy or restarting.
- **Throughput is set by the LLM's rate limit, not by us.** At 500 requests a minute (a setting, `OPENAI_REQUESTS_PER_MINUTE`), 50,000 labels take about 100 minutes however many workers run. This is due to the OpenAI rate limits. A token bucket shared by all workers paces them to that limit. Identical files are recognised by their SHA-256 and read once.
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
- **Manual retry** is offered for any failure but a missing file, such as after credit is topped up.

## Performance

- **The database searches, filters and pages every list.** Keyset cursors keep a deep page as quick as the first, and event details load only when opened.
- **Every list has an index to match.** Partial indexes fit the exact filter and order of Products, each person's own lists and the System page's figures; product and log searches use trigram indexes. I checked the upload queries with EXPLAIN on 60,000 local products.
- **Bulk actions take one pass.** Deleting 100 products is one read, one storage request and one transaction, not 100 of each.
- **Pushed, not polled.** Server-sent events say what changed; polling is only the fallback while the stream is down.
- **Less work in the browser.** A new search keeps the last results up while it loads, off-screen rows skip layout (`content-visibility`), and the System page, calendar and PDF preview load on first use.

## Trade-offs

- **Supabase Storage over S3 or R2.** One platform for database, queue and files was simpler. Storage sits behind an interface, so switching is one file. YAGNI.
- **Confidence from the model, checked by code.** The model scores each field in the same call; extracting twice and comparing would measure doubt better, at double the cost. Its scores aren't calibrated, so plain checks lower any field the rest of the data contradicts, and people can mark fields as checked.
- **Review before Products.** A read label waits with its uploader until they submit it, and anything the model was unsure of must be checked by a person first. Products is the record other people rely on, so a doubtful reading shouldn't reach it unseen; the price is a step for every upload, kept small by submitting everything that's ready at once. "Mark all as checked" stays, behind a confirmation, for someone who has looked through a batch in the panel.
- **One file, one product.** A product can't be built from several files, such as a pack's front and back. Adding many products in one batch is the more frequent and more valuable need, and a company most likely keeps each label as a single file already. Allowing both would make uploading harder for everyone, for a case that rarely comes up.
- **SupplyScope's own UI stack** (Tailwind v4, shadcn/ui), so it feels like a SupplyScope product. Desktop only.
- **Left out for now:** team management (accounts come from a script), CI, HEIC photos and rollback migrations. A label can occasionally be read twice if a worker loses the database mid-call; the claim token makes the second read harmless.
