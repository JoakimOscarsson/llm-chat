# Decision Log And Open Questions

## Current Recommendations

### 1. Use A Backend Gateway

Decision:
Recommended.

Reason:
It is the safest and most flexible way to handle auth headers, streaming normalization, and future metrics integration.

### 2. Model Refresh Strategy

Decision:
Fetch on app load plus manual refresh button.

Reason:
Model inventories usually change rarely, and manual refresh keeps the behavior predictable. We can add light periodic refresh later if you want it.

### 3. Session Persistence

Decision:
Start with browser-local persistence only.

Reason:
It avoids adding a database before the chat workflow is proven.

### 4. Metrics Strategy

Decision:
Design and stub the GPU metrics panel now, but treat the backend as optional.

Reason:
This matches your request and keeps the UI ready without delaying chat delivery.

## Ollama Features Worth Discussing Before Implementation

### Strong Candidates For V1

- `options` passthrough for sampling and context controls
- `system` prompt support
- `keep_alive` support to reduce cold-start latency
- model list refresh
- request cancellation

### Good Candidates For V1.1

- structured JSON output mode
- image/multimodal input
- tool calling
- session presets per model
- conversation export/import

### Likely Not Worth V1 On A 16 GB GPU Budget

- UI workflows that encourage very large context windows by default
- parallel multi-model comparison mode
- automatic background summarization jobs on every turn
- anything that assumes several large models can stay hot simultaneously

## Questions To Confirm

### 1. Frontend Stack Preference

Recommendation:
React + TypeScript + Vite.

Open question:
Do you want to stay with this conventional stack, or do you have a preferred framework?

Status:
Confirmed. Use React + TypeScript + Vite.

### 2. Backend Stack Preference

Recommendation:
Node.js + TypeScript + Fastify.

Open question:
Is that acceptable, or do you prefer another backend language/runtime?

Status:
Confirmed. Use Node.js + TypeScript + Fastify.

### 3. Thinking Stream Semantics

Open question:
Should thinking be persisted in chat history by default, or shown transiently unless the user explicitly saves it?

Recommendation:
Show it live, but do not persist it by default until we see how noisy it is in practice.

Status:
Updated. Show thinking live in the separate thinking panel while streaming. Persist it in chat history, but collapsed by default so the user can expand it on demand.

### 4. Upstream Auth Header Names

Open question:
Should the app treat header names as configurable, or do you already know the exact names required by the Cloudflare-protected upstream?

Recommendation:
Make names configurable.

Status:
Confirmed fixed header names:

- `CF-Access-Client-Id`
- `CF-Access-Client-Secret`

### 5. Settings Scope

Open question:
Should advanced Ollama options be global app defaults, per-session settings, or both?

Recommendation:
Use global defaults plus per-session overrides.

Status:
Confirmed. The app will support global defaults and per-session overrides, with an explicit reset-to-default flow.

### 6. Model Management

Open question:
Should the UI only list available models, or also allow pull/delete operations later?

Recommendation:
List/select only for V1.

### 7. Service Topology

Decision:
Adopt a microservice-first monorepo layout from the beginning.

Reason:
This supports future agentic workflows, cleaner service ownership, easier repo splits later, and contract-first implementation.

### 8. Kubernetes Packaging

Decision:
Use a top-level Helm chart with in-cluster Postgres and Redis.

Reason:
This keeps deployment configuration reusable, environment-driven, and aligned with the new horizontal scaling model.

### 9. Ollama Parallelism Limit

Decision:
Enforce a cluster-wide concurrency limit above Ollama using Redis-backed queue coordination.

Reason:
The upstream backend is VRAM-constrained, so scaling app pods must not translate into unconstrained parallel model execution.

### 10. Warmup Semantics Under Load

Decision:
Warmup is idle-only and must be skipped when any request is active or queued.

Reason:
Standalone warmup requests during queue pressure would churn model residency and waste scarce GPU capacity.

## Additional Features I Recommend Discussing

- Regenerate reply
- Copy raw response vs copy cleaned response
- Export session as Markdown
- Connection diagnostics panel
- Time-to-first-token and total generation timing
