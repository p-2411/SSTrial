# Label extractor

Upload photos or PDFs of product labels; a background worker reads each one with an LLM and extracts the **product name, brand, ingredients, allergens and net weight** as validated, structured JSON.

![The app: upload list on the left, extracted label data on the right](docs/screenshot.png)

- **Stack:** TypeScript end to end. React + Vite (web), Fastify (API), pg-boss (Postgres-backed queue), Supabase (Postgres + Storage), OpenAI Responses API with structured outputs.
- **Design decisions** (queue choice, failure handling, 50k uploads, trade-offs): [DECISIONS.md](DECISIONS.md)

## Topology

```mermaid
flowchart LR
  B[Browser<br/>React SPA]
  subgraph App["App container (one image)"]
    API["API process<br/>node server/src/api/main.ts<br/>(also serves the built UI)"]
    W["Worker process(es)<br/>node server/src/worker/main.ts"]
  end
  subgraph Supabase
    PG[("Postgres<br/>uploads table<br/>+ pgboss schema = queue")]
    ST[("Storage<br/>private 'labels' bucket")]
  end
  LLM[OpenAI API]

  B -- "1. POST /api/uploads" --> API
  B -- "2. PUT file (signed URL)" --> ST
  B -- "3. POST …/complete" --> API
  B -- "poll status" --> API
  API -- "row + job in one transaction" --> PG
  W -- "claim job (SKIP LOCKED)" --> PG
  W -- download --> ST
  W -- extract --> LLM
```

| Piece | What runs it |
|---|---|
| **Web app** | Static files built by Vite. Served by the API process in production, or by the Vite dev server in development. |
| **API** | Node process (`server/src/api/main.ts`). Stateless; scale by adding instances. Never calls the LLM. |
| **Worker** | A separate Node process (`server/src/worker/main.ts`), same image with a different command. Scale by adding processes; each handles `WORKER_CONCURRENCY` jobs at once. |
| **Queue** | [pg-boss](https://github.com/timgit/pg-boss) tables in the `pgboss` schema of the same Supabase Postgres database. |
| **Database** | Supabase Postgres, with the `uploads` table as the source of truth for status and results. |
| **File storage** | Supabase Storage, in a private bucket. Browsers upload with short-lived signed URLs; size and type limits are enforced by the bucket. |

**Deployment status:** not deployed yet. The plan is hosted Supabase for Postgres and Storage, plus any container host running the image twice: the API service (public, port 3000) and a worker service (no port, `node server/src/worker/main.ts`). Apply the migration with `supabase link && supabase db push`, then set the variables from `server/.env.example`. `DATABASE_URL` should be the **session pooler** URL, because the direct connection is IPv6-only on Supabase's free tier.

### Upload lifecycle

```
uploading ─(browser confirms)─► queued ─(worker claims)─► processing ─► completed
  (hidden)                        ▲                            │
                                  └──(transient error; retry)──┤
                                                               └──► failed (reason shown; retry if it could help)
```

## Running locally

**Prerequisites:** Node 22.18 or newer (the server runs TypeScript directly), Docker, and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

```bash
npm install
supabase start                     # local Postgres + Storage in Docker; applies supabase/migrations
cp server/.env.example server/.env # then fill in the two blanks:
                                   #   SUPABASE_SECRET_KEY  ← SECRET_KEY from `supabase status -o env`
                                   #   OPENAI_API_KEY       ← your key
npm run dev                        # API :3000, worker, and web on http://localhost:5173
```

`samples/` has a label as PNG and PDF, and a text file renamed to `.jpg` to try the content check.

**Production image via Docker Compose** (API serving the built UI on http://localhost:3000, plus two workers):

```bash
supabase start
docker compose up --build
```

## Tests

```bash
npm test                  # all unit tests (shared, server, web). No network, no LLM, no Docker needed.
npm run test:integration -w server   # real pg-boss worker against local Postgres (needs `supabase start`)
```

The LLM is never called from tests. The worker depends on a `LabelExtractor` interface, and the OpenAI extractor takes an injected "create response" function that tests replace with canned responses.

| Required case | Where |
|---|---|
| **Unsupported file type** | `shared/test/files.test.ts` (extensions, MIME types, HEIC, size, empty); `server/test/api/uploads.test.ts` (422 from the API; a text file renamed `.jpg` is caught by byte sniffing) |
| **Malformed / invalid LLM response** | `server/test/extraction/openai-extractor.test.ts` (not JSON, truncated, wrong types, bad units, empty, refusal, content filter); `server/test/worker/process-upload.test.ts` (malformed output is retried, never stored) |
| **Job failure and retry** | `server/test/worker/process-upload.test.ts` (transient error → retry, recovery on a later attempt, give up after the last attempt, permanent errors not retried, duplicate/stale jobs); `server/test/integration/worker.integration.test.ts` (the same against real pg-boss, including a hung worker rescued by the dead-letter queue) |

## Project structure

```
shared/          Zod schemas and types used by all three: file rules, extraction schema, API contracts
server/
  src/api/       HTTP API process (Fastify): routes, error handling, entry point
  src/worker/    Worker process: job handler (retry decisions) and pg-boss wiring
  src/extraction/ LLM integration: interface, OpenAI implementation, prompt, error classification
  src/uploads/   The uploads table: guarded status transitions, response mapping
  src/infra/     Config, database, queue, storage, logging, file-type sniffing
  test/          Unit tests (with in-memory fakes) and the integration test
web/src/
  api/           API client and React Query hooks (polling lives here)
  features/      upload (dropzone + upload manager), uploads-list, upload-detail
  components/    Small shared UI pieces (button, status badge, skeleton, errors)
supabase/        Local config and the SQL migration (uploads table, storage bucket)
```

## API

| Method | Path | |
|---|---|---|
| `POST` | `/api/uploads` | Validate `{ fileName, mimeType, sizeBytes }` and return `{ upload, uploadUrl }` |
| `POST` | `/api/uploads/:id/complete` | Check the uploaded bytes, then queue the upload (idempotent) |
| `GET` | `/api/uploads` | Newest 100 uploads |
| `GET` | `/api/uploads/:id` | One upload with its extracted data and a preview URL |
| `POST` | `/api/uploads/:id/retry` | Re-queue a failed upload when retrying could help |

Errors are always `{ "error": { "code", "message" } }`, with a message written for users.

## Scope cuts

Deliberately left out to stay within the time box. The reasoning is in [DECISIONS.md](DECISIONS.md#other-trade-offs-and-things-deliberately-left-out).

- **Authentication and per-user data:** everyone sees one shared list.
- **Clean-up of abandoned uploads** and of files rejected on content.
- **Push updates** (polling instead), **pagination** (list capped at 100) and **a shared rate limiter** across workers.
- **HEIC conversion** and a **PDF page-count limit**.
- **Deployment.** The image and the plan above are ready, but it needs Supabase and hosting accounts.
