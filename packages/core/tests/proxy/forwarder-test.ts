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
import { it } from "node:test";
import assert from "node:assert";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import {
  parseProxyPath,
  rewriteForUpstream,
  forwardRequest,
} from "../../src/core/proxy/forwarder.js";
import { createHeaders } from "../../src/core/request/header-object.js";
import { intoSearchParams } from "../../src/core/request/search-object.js";

it("parses a proxy path prefix", () => {
  assert.deepEqual(parseProxyPath("/proxy:api/widgets/1"), {
    name: "api",
    pathname: "/widgets/1",
  });
  assert.deepEqual(parseProxyPath("/proxy:api"), {
    name: "api",
    pathname: "/",
  });
  assert.equal(parseProxyPath("/widgets/1"), undefined);
});

it("rewrites faithfully: strips prefix, swaps origin, keeps the rest", () => {
  const { name, request } = rewriteForUpstream(
    {
      method: "POST",
      origin: "http://localhost:8080",
      pathname: "/proxy:api/orders",
      searchParams: intoSearchParams({ dry: "1" }),
      headers: createHeaders({
        host: "localhost:8080",
        connection: "keep-alive",
        "content-length": "9",
        "x-trace": "abc",
      }),
      body: `{"item":1}`,
    },
    { api: { origin: "https://api.example.com" } },
  );

  assert.equal(name, "api");
  assert.equal(request.method, "POST");
  assert.equal(request.origin, "https://api.example.com");
  assert.equal(request.pathname, "/orders");
  assert.equal(request.searchParams?.get("dry"), "1");
  assert.equal(request.body, `{"item":1}`);
  // untouched header preserved; hop-by-hop headers dropped
  assert.equal(request.headers.get("x-trace"), "abc");
  assert.equal(request.headers.get("host"), null);
  assert.equal(request.headers.get("connection"), null);
  assert.equal(request.headers.get("content-length"), null);
});

it("rejects an unknown upstream or a missing prefix", () => {
  assert.throws(() =>
    rewriteForUpstream(
      { pathname: "/proxy:nope/x", headers: createHeaders() },
      { api: { origin: "https://api.example.com" } },
    ),
  );
  assert.throws(() =>
    rewriteForUpstream(
      { pathname: "/x", headers: createHeaders() },
      { api: { origin: "https://api.example.com" } },
    ),
  );
});

it("forwards a request byte-faithfully to the upstream", async () => {
  const received: {
    method?: string;
    url?: string;
    trace?: string | string[];
    body: string;
  } = { body: "" };

  const upstream = createServer((req: IncomingMessage, res) => {
    received.method = req.method;
    received.url = req.url;
    received.trace = req.headers["x-trace"];
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.body = Buffer.concat(chunks).toString();
      res.writeHead(201, { "content-type": "application/json" });
      res.end(`{"ok":true}`);
    });
  });

  await new Promise<void>((resolve) => upstream.listen(0, resolve));
  try {
    const { port } = upstream.address() as AddressInfo;

    const { request } = rewriteForUpstream(
      {
        method: "POST",
        origin: "http://localhost:9999",
        pathname: "/proxy:api/orders",
        searchParams: intoSearchParams({ dry: "1" }),
        headers: createHeaders({ "x-trace": "abc" }),
        body: `{"item":1}`,
      },
      { api: { origin: `http://127.0.0.1:${port}` } },
    );

    const response = await forwardRequest(request);

    assert.equal(received.method, "POST");
    assert.equal(received.url, "/orders?dry=1");
    assert.equal(received.trace, "abc");
    assert.equal(received.body, `{"item":1}`);

    assert.equal(response.status, 201);
    assert.equal(response.body, `{"ok":true}`);
    assert.equal(response.headers.get("content-type"), "application/json");
  } finally {
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
