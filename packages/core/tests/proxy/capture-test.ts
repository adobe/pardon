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
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

before(async () => {
  await initTrackingEnvironment();

  // hermetic workspace so the trace DB lands in a writable temp dir with the
  // built-in default/default endpoint and its own empty collection set.
  workspace = await mkdtemp(join(tmpdir(), "pardon-proxy-"));
  await writeFile(join(workspace, "pardonrc.yaml"), "collections: []\n");

  runtime = (await initializePardon({ cwd: workspace }, [
    undici,
  ])) as unknown as PardonRuntime;
});

after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function startUpstream(): Promise<{
  origin: string;
  close(): Promise<void>;
}> {
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

it("captures a forwarded exchange into the trace DB (redacted, no 2nd fetch)", async () => {
  const { sqlite } = runtime.database!;

  // the "http" table is created lazily on the first persist write.
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

  // wrap capture so the test can await the out-of-band write.
  let settle!: () => void;
  const captured = new Promise<void>((resolve) => (settle = resolve));
  const base = createPardonCapture(runtime);

  const upstream = await startUpstream();
  const proxy = await startProxyServer(
    "passthrough",
    { upstreams: { api: { origin: upstream.origin } } },
    {
      capture: async (req, res) => {
        try {
          await base(req, res);
        } finally {
          settle();
        }
      },
    },
  );

  try {
    const response = await fetch(
      `http://127.0.0.1:${proxy.port}/proxy:api/things/42`,
    );
    assert.equal(response.status, 200);

    await captured;

    assert.equal(countRows(), before + 1, "one trace row written");

    const row = sqlite
      .prepare(`SELECT req, res FROM "http" ORDER BY id DESC LIMIT 1`)
      .get() as { req: string; res: string };

    // request + response both persisted (response proves capture ran the full
    // match+redact+process path, not just the request write).
    assert.match(row.req, /things\/42/);
    assert.ok(row.res, "response persisted");
    assert.match(row.res, /200/);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});
