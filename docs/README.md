# LLM Chat App Planning Docs

This directory contains the initial planning package for a Docker-based web chat interface targeting an Ollama-compatible backend.

## Documents

- `product-spec.md`: Scope, goals, user flows, and functional requirements.
- `architecture-spec.md`: System design, runtime components, data flow, and major technical decisions.
- `microservices-architecture.md`: Service boundaries, extraction strategy, and agent-friendly topology.
- `implementation-plan.md`: Phased execution plan with milestones and acceptance criteria.
- `scalability-architecture-spec.md`: Kubernetes target architecture, shared queue model, and storage boundaries.
- `scalability-dod.md`: Definition of done for the scalability tracks.
- `scalability-implementation-plan.md`: High-level phase order for the scalability work.
- `scalability-agent-workstreams.md`: Track ownership and branch layout for parallel implementation.
- `scalability-workstream-contracts.md`: Frozen queue/runtime payloads for implementation tracks.
- `scalability-merge-sequence.md`: Gate order and merge sequence for coordinator-led integration.
- `repository-layout.md`: Proposed monorepo structure and ownership boundaries.
- `api-contracts.md`: Frontend/backend API contracts, streaming behavior, and future metrics integration.
- `interface-spec.md`: Detailed public and internal service contracts for microservice implementation.
- `agent-guides.md`: Working agreements for implementation agents and future contributors.
- `tdd-guidelines.md`: Test-driven development rules for contracts, services, streams, and UI.
- `decision-log.md`: Recommendations, tradeoffs, and open questions that should be confirmed before coding.

## Working Assumptions

- The app is a self-hosted Docker deployment.
- The LLM backend is an Ollama server reachable over HTTP(S), potentially behind Cloudflare Tunnel.
- The scalability phase targets Kubernetes with Helm, in-cluster Postgres, and in-cluster Redis.
- The UI should stream both "thinking" content and final assistant output if the backend exposes them.
- A thin app backend is preferred over direct browser-to-Ollama calls so secrets stay server-side and CORS/auth concerns stay contained.
- GPU VRAM metrics will be designed into the UI now, but the backend integration may ship later.

## Recommended Reading Order

1. `product-spec.md`
2. `architecture-spec.md`
3. `microservices-architecture.md`
4. `interface-spec.md`
5. `scalability-workstream-contracts.md`
6. `scalability-agent-workstreams.md`
7. `decision-log.md`
8. `implementation-plan.md`
