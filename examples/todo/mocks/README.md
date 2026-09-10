<!--
Copyright 2025 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0
-->

# Todo mock suite

A `.mock.https` suite that stands in for the todo service, mirroring the
`collection/todo/` layout. These files are the worked examples for the mock
execution model described in [`docs/design/proxy.md`](../../../docs/design/proxy.md)
— and they double as the fixtures the replay/compare interpreter (deliverable B)
is being built against. The interpreter isn't wired up yet, so today these are
**spec-by-example**: authored to exercise every feature of the format, ready to
run once the runtime lands.

Wire them to the `api` upstream via the proxy config's `mocks` glob:

```js
proxy: {
  upstreams: {
    todo: { origin: "http://localhost:3000", mocks: "mocks/todo/**" },
  },
}
```

## What each file demonstrates

| File | Endpoint | Format features |
| ---- | -------- | --------------- |
| `health-check.mock.https` | `GET /health-check` | static: one matcher, one response, no state |
| `users/create.mock.https` | `POST /users` | `store` write, `goto('conflict')` guard |
| `users/login.mock.https` | `PUT /users` | value-duality on `token`, `goto('unauthorized')` |
| `users/delete.mock.https` | `DELETE /users` | token→username, cascading `store` delete, `goto('missing')` |
| `todos/create.mock.https` | `POST /todos` | id generation via duality, post-response `store` write |
| `todos/get.mock.https` | `GET /todos/{todo}` | `store` read + `replay({ task })` for the un-synthesizable `debug` server block (miss-tolerant) |
| `todos/list.mock.https` | `GET /todos` | derived list body from `store` |
| `todos/update.mock.https` | `PUT /todos/{todo}` | partial merge into `store`, `goto('missing')` |
| `todos/delete.mock.https` | `DELETE /todos/{todo}` | `store` delete, `goto('missing')` |

Together they cover the three points on the spectrum called for in the design:
**static** (health-check), **stateful store** (all CRUD), and **replay-backed**
(the `debug` server block in `get`).

### Why `replay()` earns its keep here

Every ordinary todo response is a pure function of `store`, so the mock can
synthesize it — `replay()` would be busywork. The exception is the special
**`debug`** task: reading it makes the real server append a `server` block
(`version`, `node`, `pid`, `uptime`) that the mock has no way to know. That
content originates outside the modeled state, so `get.mock.https` grafts it from
a **captured** exchange:

```
if (task == "debug" && (debug = replay({ task }))) {
  goto('done')   // <<< done emits the todo + the replayed server block
}
```

`replay({ task })` may miss (nothing captured yet) — then we simply fall through
to the plain todo response without the `server` block. This is the honest shape
of `replay()`: it supplies only what the mock can't, and degrades gracefully.
The dynamic fields (`uptime`, `pid`) also make it a natural **compare** target —
they're expected to vary between the captured baseline and live traffic.

## Conventions & assumptions

- **State lives in `store`.** The per-session ephemeral object stands in for the
  service's in-memory tables: `store.users[username] = password`,
  `store.todos[username][id] = { task, done }`, and a `store.nextTodoId`
  counter for `T####` ids.
- **The token is opaque.** Login mints a token and records
  `store.tokens[token] = username`; authed mocks recover the caller by looking
  the token up (`username = store.tokens[token]`), never by parsing it. An
  unknown token is a 401. Captured tokens populate the same mapping, so this
  works identically in capture, replay, and compare.
- **Value duality drives generated fields.** `token` and `id` are written as
  `name = <expr>` defaults so they are matched/extracted in capture and
  evaluated (invented) in replay/mock — one expression, all modes.
- **Scripts assume standard JS globals** (`JSON`, `Object`, `atob`/`btoa`) plus
  the mock builtins (`store`, `goto`, `replay`, `compare`) and the request
  bindings (`endpoint`, path/body values). Final grounding of the script
  sandbox happens when the interpreter lands.
