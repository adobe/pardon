/*
Copyright 2026 Adobe. All rights reserved.
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
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initTrackingEnvironment } from "../../src/runtime/environment.js";
import { initializePardon } from "../../src/runtime/initialize.js";
import undici from "../../src/features/undici.js";
import { startProxyServer } from "../../src/core/proxy/server.js";
import { createPardonCapture } from "../../src/core/proxy/capture.js";
import type { PardonRuntime } from "../../src/core/pardon/types.js";

let workspace: string;
let runtime: PardonRuntime;
let upstream: { origin: string; close(): Promise<void> };

async function startUpstream() {
  const server: Server = createServer((req: IncomingMessage, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

before(async () => {
  await initTrackingEnvironment();

  upstream = await startUpstream();

  // a collection whose service mixin injects a *generated* auth token. Under the
  // old egress-render capture path, redacting a request that matched this
  // (including the service `default` bucket) would evaluate `boom()` and throw;
  // capture must instead leave the generator unresolved.
  workspace = await mkdtemp(join(tmpdir(), "pardon-capture-redact-"));
  await writeFile(
    join(workspace, "pardonrc.yaml"),
    "collections:\n  - ./collection\n",
  );

  const svc = join(workspace, "collection", "svc");
  await mkdir(svc, { recursive: true });
  await writeFile(
    join(svc, "service.yaml"),
    `config:\n  origin: ${upstream.origin}\nmixin:\n  - ./auth.mix.https\n`,
  );
  await writeFile(
    join(svc, "auth.mix.https"),
    `config:\n  auth-type: user\n>>>\nANY //\nAuthorization: Bearer {{@token = boom()}}\n`,
  );

  runtime = (await initializePardon({ cwd: workspace }, [
    undici,
  ])) as unknown as PardonRuntime;
});

after(async () => {
  await upstream.close();
  await rm(workspace, { recursive: true, force: true });
});

it("captures without evaluating request-generating expressions", async () => {
  const { sqlite } = runtime.database!;

  const countRows = () => {
    const table = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='http'`,
      )
      .get();
    if (!table) return 0;
    return (
      sqlite.prepare(`SELECT COUNT(*) AS n FROM "http"`).get() as { n: number }
    ).n;
  };
  const before = countRows();

  let settle!: () => void;
  let captureError: unknown;
  const captured = new Promise<void>((resolve) => (settle = resolve));
  const base = createPardonCapture(runtime);

  const proxy = await startProxyServer(
    "passthrough",
    { upstreams: { svc: { origin: upstream.origin } } },
    {
      capture: async (req, res) => {
        try {
          await base(req, res);
        } catch (error) {
          captureError = error;
        } finally {
          settle();
        }
      },
    },
  );

  try {
    // no Authorization header on the wire — the token generator has nothing to
    // extract, and must not be invoked.
    const response = await fetch(
      `http://127.0.0.1:${proxy.port}/proxy:svc/anything`,
    );
    assert.equal(response.status, 200);

    await captured;

    assert.equal(captureError, undefined, "capture must not throw on render");
    assert.equal(countRows(), before + 1, "one trace row written");

    const row = sqlite
      .prepare(`SELECT req, res FROM "http" ORDER BY id DESC LIMIT 1`)
      .get() as { req: string; res: string };

    // the generator was skipped, so no invented/real token leaked into storage.
    assert.doesNotMatch(row.req, /Bearer\s+\S/, "no generated token persisted");
    assert.ok(row.res, "response persisted");
  } finally {
    await proxy.close();
  }
});
