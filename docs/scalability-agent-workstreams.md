# Scalability Agent Workstreams

## Coordinator

- branch: `coord/scalability-integration`
- owns contracts, docs, and final integration

## Track 1

- branch: `track/10-session-postgres`
- owns `services/session-service/**`

## Track 2

- branch: `track/20-ollama-redis-queue`
- owns `services/ollama-adapter/**`

## Track 3

- branch: `track/30-chat-gateway-integration`
- owns `services/chat-service/**` and `services/api-gateway/**`

## Track 4

- branch: `track/40-web-queue-ux`
- owns `apps/web/**`

## Track 5

- branch: `track/50-helm-deploy`
- owns `deploy/helm/**`

## Track 6

- branch: `track/60-compose-parity`
- owns `compose.yaml` and local env/example docs

## Handoff Requirements

Each track must report:

- branch name
- files changed
- tests added or updated
- new env vars
- interfaces touched
- known limitations
