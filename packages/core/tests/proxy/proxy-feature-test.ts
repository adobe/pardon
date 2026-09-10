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

import proxy from "../../src/features/proxy.js";
import { PardonError } from "../../src/core/error.js";
import type { PardonFetchExecution } from "../../src/core/pardon/pardon.js";
import type { FetchObject } from "../../src/core/request/fetch-object.js";

/**
 * Compose `proxy` over a stub inner execution whose `fetch` just records the
 * (possibly rewritten) request it was handed, so we can assert what would go on
 * the wire.
 */
function drive(request: FetchObject) {
  let seen: FetchObject | undefined;
  const base = {
    executor: {
      async fetch(info: { egress: { request: FetchObject } }) {
        seen = info.egress.request;
        return { status: 200, headers: new Headers() };
      },
      async init() {},
      async match() {},
      async preview() {},
      async render() {},
      async process() {},
      error() {},
    },
  } as unknown as typeof PardonFetchExecution;

  const composed = proxy(base);
  return {
    run: () =>
      composed.executor.fetch({ egress: { request } } as never) as Promise<
        unknown
      >,
    seen: () => seen,
  };
}

function request(meta?: Record<string, string>): FetchObject {
  return {
    method: "GET",
    origin: "https://todo.example.com",
    pathname: "/todos",
    headers: new Headers(),
    meta,
  };
}

it("reroutes origin and prefixes the path when [proxy] is present", async () => {
  const req = request({ proxy: "http://localhost:8080/proxy:todo" });
  const { run } = drive(req);
  await run();

  assert.equal(req.origin, "http://localhost:8080");
  assert.equal(req.pathname, "/proxy:todo/todos");
});

it("leaves the request untouched when there is no [proxy] header", async () => {
  const req = request();
  const { run } = drive(req);
  await run();

  assert.equal(req.origin, "https://todo.example.com");
  assert.equal(req.pathname, "/todos");
});

it("tolerates a trailing slash on the proxy prefix", async () => {
  const req = request({ proxy: "http://localhost:8080/proxy:todo/" });
  const { run } = drive(req);
  await run();

  assert.equal(req.pathname, "/proxy:todo/todos");
});

it("prefixes a root path without doubling the slash", async () => {
  const req = request({ proxy: "http://localhost:8080/proxy:todo" });
  req.pathname = "/";
  const { run } = drive(req);
  await run();

  assert.equal(req.pathname, "/proxy:todo/");
});

it("throws a PardonError for a non-URL [proxy] target", async () => {
  const req = request({ proxy: "not a url" });
  const { run } = drive(req);
  await assert.rejects(run(), (error) => error instanceof PardonError);
});
