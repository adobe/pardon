/*
Copyright 2025 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/
import { after, before, it } from "node:test";
import assert from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initTrackingEnvironment } from "../../src/runtime/environment.js";
import { initializePardon } from "../../src/runtime/initialize.js";
import undici from "../../src/features/undici.js";
import { startProxyServer } from "../../src/core/proxy/server.js";
import type { ProxyServer } from "../../src/core/proxy/server.js";

let workspace: string;
let mocksDir: string;
let proxy: ProxyServer;

const MOCKS: Record<string, string> = {
  // static — one matcher, one response, no scripts, no state.
  "ping.mock.https": `>>>
GET https://svc.example/ping

<<<
200 OK
Content-Type: text/plain

pong`,

  // stateful write + value-duality token invention (btoa) + goto conflict +
  // a post-response script recording token->name into the session store.
  "users/register.mock.https": `
import:
  global:
    - btoa  
>>>
POST https://svc.example/users
Content-Type: application/json

{
  name: "{{name}}"
}

!!!
if (store.users?.[name]) {
  goto('conflict')
}
(store.users ??= {})[name] = true

<<<
200 OK
Content-Type: application/json

{
  token: token = (\`tok.\${btoa(name)}\`)
}

!!!
(store.tokens ??= {})[token] = name

<<< conflict
409 Conflict
Content-Type: text/plain

exists`,

  // opaque-token lookup: read-after-assign of \`name\`, goto unauthorized.
  "users/whoami.mock.https": `>>>
GET https://svc.example/whoami
Authorization: Bearer {{@token}}

!!!
name = store.tokens?.[token]
if (!name) {
  goto('unauthorized')
}

<<<
200 OK
Content-Type: application/json

{ name }

<<< unauthorized
401 Unauthorized
Content-Type: text/plain

unauthorized`,

  // value-duality id from a monotonic store counter + post-response store write.
  "items/create.mock.https": `>>>
POST https://svc.example/items
Content-Type: application/json

{
  label
}

!!!
nextId = (store) => store.nextId = (store.nextId ?? 100) + 1

<<<
200 OK
Content-Type: application/json

{
  id: id = (\`I\${nextId(store)}\`),
  label
}

!!!
(store.items ??= {})[id] = { label }
`,
};

async function get(path: string, headers?: Record<string, string>) {
  const response = await fetch(
    `http://127.0.0.1:${proxy.port}/proxy:svc${path}`,
    {
      headers,
    },
  );
  const body = await response.text();
  return { status: response.status, body };
}

async function post(path: string, json: unknown) {
  const response = await fetch(
    `http://127.0.0.1:${proxy.port}/proxy:svc${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(json),
    },
  );
  const body = await response.text();
  return { status: response.status, body };
}

before(async () => {
  await initTrackingEnvironment();

  workspace = await mkdtemp(join(tmpdir(), "pardon-mock-serving-"));
  await writeFile(
    join(workspace, "pardonrc.yaml"),
    "collections:\n  - ./collection\n",
  );
  // a trivial collection so initializePardon succeeds; the mock suite is
  // independent of it.
  const svc = join(workspace, "collection", "svc");
  await mkdir(svc, { recursive: true });
  await writeFile(
    join(svc, "service.yaml"),
    "config:\n  origin: https://svc.example\n",
  );

  mocksDir = join(workspace, "mocks");
  for (const [rel, content] of Object.entries(MOCKS)) {
    const path = join(mocksDir, rel);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }

  await initializePardon({ cwd: workspace }, [undici]);

  proxy = await startProxyServer("mock", {
    upstreams: {
      // absolute mocks path so it resolves regardless of process cwd.
      svc: { origin: "https://svc.example", mocks: mocksDir },
    },
  });
});

after(async () => {
  await proxy?.close();
  await rm(workspace, { recursive: true, force: true });
});

it("serves a static mock", async () => {
  const { status, body } = await get("/ping");
  assert.equal(status, 200);
  assert.equal(body, "pong");
});

it("serves stateful CRUD with goto, value-duality, and a shared store", async () => {
  // register — invents an opaque token via btoa and records it.
  const registered = await post("/users", { name: "ada" });
  assert.equal(registered.status, 200);
  const { token } = JSON.parse(registered.body) as { token: string };
  assert.match(token, /^tok\./, "token invented from the duality expression");

  // re-register — the store persists across requests, so goto('conflict').
  const conflict = await post("/users", { name: "ada" });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body, "exists");

  // whoami with the opaque token — read-after-assign of `name` resolves it.
  const whoami = await get("/whoami", { authorization: `Bearer ${token}` });
  assert.equal(whoami.status, 200);
  assert.deepEqual(JSON.parse(whoami.body), { name: "ada" });

  // whoami with a bogus token — goto('unauthorized').
  const denied = await get("/whoami", { authorization: "Bearer nope" });
  assert.equal(denied.status, 401);
  assert.equal(denied.body, "unauthorized");
});

it("invents monotonic ids from a store counter", async () => {
  const first = await post("/items", { label: "one" });
  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(first.body), { id: "I101", label: "one" });

  const second = await post("/items", { label: "two" });
  assert.deepEqual(JSON.parse(second.body), { id: "I102", label: "two" });
});
