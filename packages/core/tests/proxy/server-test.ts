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
import { before, it } from "node:test";
import assert from "node:assert";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { startProxyServer } from "../../src/core/proxy/server.js";
import { initTrackingEnvironment } from "../../src/runtime/environment.js";

before(async () => {
  await initTrackingEnvironment();
});

/** Start a stub upstream that echoes what it received as JSON. */
async function startUpstream(): Promise<{
  origin: string;
  last: { method?: string; url?: string; body: string };
  close(): Promise<void>;
}> {
  const last: { method?: string; url?: string; body: string } = { body: "" };
  const server: Server = createServer((req: IncomingMessage, res) => {
    last.method = req.method;
    last.url = req.url;
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      last.body = Buffer.concat(chunks).toString();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ saw: req.url }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    last,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

it("routes /proxy:<name>/... to the matching upstream and publishes the port", async () => {
  const upstream = await startUpstream();
  const proxy = await startProxyServer({
    upstreams: { api: { origin: upstream.origin } },
  });

  try {
    assert.ok(proxy.port > 0);
    assert.equal(environment["proxy-port"], proxy.port);

    const response = await fetch(
      `http://127.0.0.1:${proxy.port}/proxy:api/widgets/1?q=2`,
    );
    const json = (await response.json()) as { saw: string };

    assert.equal(response.status, 200);
    assert.equal(upstream.last.url, "/widgets/1?q=2");
    assert.equal(json.saw, "/widgets/1?q=2");
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

it("returns 404 for an unknown upstream", async () => {
  const proxy = await startProxyServer({ upstreams: {} });
  try {
    const response = await fetch(
      `http://127.0.0.1:${proxy.port}/proxy:missing/x`,
    );
    assert.equal(response.status, 404);
  } finally {
    await proxy.close();
  }
});

it("returns 404 for a path without a proxy prefix", async () => {
  const proxy = await startProxyServer({ upstreams: {} });
  try {
    const response = await fetch(`http://127.0.0.1:${proxy.port}/nope`);
    assert.equal(response.status, 404);
  } finally {
    await proxy.close();
  }
});

it("serves the control-plane health probe on /runner/health", async () => {
  const proxy = await startProxyServer({ upstreams: {} });
  try {
    const response = await fetch(
      `http://127.0.0.1:${proxy.port}/runner/health`,
    );
    const json = (await response.json()) as { status: string };
    assert.equal(response.status, 200);
    assert.equal(json.status, "ok");
  } finally {
    await proxy.close();
  }
});

it("404s unknown control endpoints without proxying them", async () => {
  const upstream = await startUpstream();
  const proxy = await startProxyServer({
    upstreams: { runner: { origin: upstream.origin } },
  });
  try {
    // even with an upstream literally named "runner", /runner/ is control
    // plane and is never forwarded.
    const response = await fetch(`http://127.0.0.1:${proxy.port}/runner/plan`);
    assert.equal(response.status, 404);
    assert.equal(upstream.last.url, undefined, "control traffic not forwarded");
  } finally {
    await proxy.close();
    await upstream.close();
  }
});
