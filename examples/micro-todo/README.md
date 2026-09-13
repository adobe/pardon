# micro-todo

A small multi-service PoC for the pardon recording proxy. It splits the single
`examples/todo` service into three zero-dependency mini services (same
mini-framework: `../lib/mini-router.js`, `mini-signal.js`, `mini-server.js`):

| service    | port | responsibility                                              |
| ---------- | ---- | ----------------------------------------------------------- |
| `api`      | 4000 | public todo API (BFF) — no user state of its own            |
| `identity` | 4001 | system of record for users; mints and validates tokens      |
| `task`     | 4002 | stores and updates task state, scoped per owner             |

## Request flow

The caller has already obtained a token (identity `POST /tokens`). On each
`/todos` call the **api**:

1. validates the caller's token against **identity** (`POST /validate` → username), then
2. relays the operation to **task** (`x-owner: <username>`).

```
client ──token──▶ api ──POST /validate──▶ identity
                   │
                   └──/tasks (x-owner)───▶ task
```

## Environment-configurable connectors

The api never hard-codes its downstreams — it reads `IDENTITY_ORIGIN` and
`TASK_ORIGIN` (see [api/server/connectors.js](api/server/connectors.js)). This
is the seam that lets the same binary run:

- **standalone** — pointed straight at the services (defaults to `localhost:4001/4002`)
- **composed** — pointed at compose DNS (`http://identity:4001`)
- **under pardon** — pointed at the recording proxy
  (`IDENTITY_ORIGIN=http://pardon:PORT/proxy:identity`), so the api's downstream
  calls are recorded/replayed without touching the api code

## Running

Composed (all three):

```bash
docker compose up --build
```

Standalone single service (from this directory):

```bash
npm run start:identity   # or start:task / start:api
```
