# Scalability Merge Sequence

## Gate A

- coordinator lands Track 0 contract and doc freeze

## Gate B

Tracks that may proceed in parallel after Gate A:

- Track 1: session Postgres
- Track 2: Ollama Redis queue
- Track 4: web queue UX using frozen fixtures and mocks
- Track 5: Helm deployment
- Track 6: compose parity

## Gate C

- Track 3 starts after Track 1 and Track 2 expose the frozen integration points

## Gate D

Coordinator merges in this order:

1. `track/10-session-postgres`
2. `track/20-ollama-redis-queue`
3. `track/30-chat-gateway-integration`
4. `track/40-web-queue-ux`
5. `track/50-helm-deploy`
6. `track/60-compose-parity`

## Rule

If an implementation track discovers a contract mismatch after Gate A, only the coordinator may update the shared contracts and interface docs.
