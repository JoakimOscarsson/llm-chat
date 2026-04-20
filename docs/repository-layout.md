# Proposed Repository Layout

## Monorepo Structure

```text
.
|- docs/
|  |- README.md
|  |- product-spec.md
|  |- architecture-spec.md
|  |- microservices-architecture.md
|  |- implementation-plan.md
|  |- repository-layout.md
|  |- api-contracts.md
|  |- interface-spec.md
|  |- agent-guides.md
|  `- decision-log.md
|- apps/
|  |- AGENTS.md
|  |- web/
|  |  |- AGENTS.md
|  |  |- src/
|  |  |  |- app/
|  |  |  |- components/
|  |  |  |- features/
|  |  |  |  |- chat/
|  |  |  |  |- models/
|  |  |  |  |- settings/
|  |  |  |  `- metrics/
|  |  |  |- hooks/
|  |  |  |- lib/
|  |  |  |- state/
|  |  |  `- styles/
|  |  |- public/
|  |  |- package.json
|  |  `- vite.config.ts
|- services/
|  |- AGENTS.md
|  |- api-gateway/
|  |  |- AGENTS.md
|  |  |- src/
|  |  |- package.json
|  |  |- Dockerfile
|  |  `- .env.example
|  |- chat-service/
|  |  |- AGENTS.md
|  |  |- src/
|  |  |- package.json
|  |  |- Dockerfile
|  |  `- .env.example
|  |- model-service/
|  |  |- AGENTS.md
|  |  |- src/
|  |  |- package.json
|  |  |- Dockerfile
|  |  `- .env.example
|  |- session-service/
|  |  |- AGENTS.md
|  |  |- src/
|  |  |- package.json
|  |  |- Dockerfile
|  |  `- .env.example
|  |- metrics-service/
|  |  |- AGENTS.md
|  |  |- src/
|  |  |- package.json
|  |  |- Dockerfile
|  |  `- .env.example
|  `- ollama-adapter/
|     |- AGENTS.md
|     |- src/
|     |- package.json
|     |- Dockerfile
|     `- .env.example
|- packages/
|  |- AGENTS.md
|  |- contracts/
|  |  |- AGENTS.md
|  |  |- src/
|  |  |  |- types/
|  |  |  |- schemas/
|  |  |  `- events/
|  |  `- package.json
|  `- config/
|     |- eslint/
|     |- typescript/
|     `- prettier/
|- docker/
|  |- web.Dockerfile
|  |- api.Dockerfile
|  `- nginx.conf
|- .env.example
|- compose.yaml
|- package.json
|- pnpm-workspace.yaml
`- README.md
```

## Rationale

- `apps/web`: browser application only.
- `services/api-gateway`: single public backend entry point for the UI.
- `services/chat-service`: chat orchestration and context shaping.
- `services/model-service`: model discovery and caching.
- `services/session-service`: session, message, and override persistence.
- `services/metrics-service`: GPU metrics adapter.
- `services/ollama-adapter`: Ollama-specific upstream communication and header injection.
- `packages/contracts`: shared request/response/event schemas so services stay aligned.
- `packages/config`: reusable lint/tsconfig presets if the repo grows.
- `docs`: planning and architectural artifacts.

## Ownership Boundaries

- Frontend work should stay inside `apps/web` unless shared types are required.
- Service logic should stay inside its owning service.
- Cross-cutting contracts should be promoted to `packages/contracts`.

## Future Expansion

Optional later additions:

- `packages/ui` for shared design system components
- `tests/` for end-to-end suites
- `ops/` for deployment manifests
