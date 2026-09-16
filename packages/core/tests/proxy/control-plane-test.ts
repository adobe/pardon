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
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initTrackingEnvironment } from "../../src/runtime/environment.js";
import { initializePardon } from "../../src/runtime/initialize.js";
import undici from "../../src/features/undici.js";
import {
  startProxyServer,
  type ProxyServer,
} from "../../src/core/proxy/server.js";
import {
  createHttpsLogRecorder,
  recordingSlug,
} from "../../src/core/proxy/record.js";
import type { ProxyMode } from "../../src/core/proxy/forwarder.js";

// The control plane drives record/replay on behalf of an external test
// framework (rather than the in-process runner): one recording open at a time,
// `POST /runner/recording/{slug}` to start and `PUT /runner/recording/{slug}`
// to finish. Finishing a replay asserts the recorded log was fully consumed —
// the load-bearing verdict the driver turns into a pass/fail.

let workspace: string;
let mocksDir: string;
let recordingsDir: string;

/** A stub upstream that echoes the request path back and counts hits. */
async function startUpstream(): Promise<{
  origin: string;
  hits: number;
  close(): Promise<void>;
}> {
  const handle = { origin: "", hits: 0, close: async () => {} };
  const server: Server = createServer((req: IncomingMessage, res) => {
    handle.hits++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ saw: req.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  handle.origin = `http://127.0.0.1:${port}`;
  handle.close = () => new Promise<void>((r) => server.close(() => r()));
  return handle;
}

async function proxyFor(mode: ProxyMode, origin: string): Promise<ProxyServer> {
  return startProxyServer(
    mode,
    {
      recordings: recordingsDir,
      upstreams: { svc: { origin, mocks: mocksDir } },
    },
    { cwd: workspace },
  );
}

function control(
  proxy: ProxyServer,
  method: "POST" | "PUT",
  slug: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${proxy.port}/runner/recording/${slug}`, {
    method,
  });
}

before(async () => {
  await initTrackingEnvironment();

  workspace = await mkdtemp(join(tmpdir(), "pardon-control-plane-"));
  await writeFile(
    join(workspace, "pardonrc.yaml"),
    "collections:\n  - ./collection\n",
  );
  const svc = join(workspace, "collection", "svc");
  await mkdir(svc, { recursive: true });
  await writeFile(
    join(svc, "service.yaml"),
    "config:\n  origin: https://svc.example\n",
  );

  // generic record/replay mock: match anything, forward-and-record (record) or
  // resolve-by-cursor (replay).
  mocksDir = join(workspace, "mocks");
  await mkdir(mocksDir, { recursive: true });
  await writeFile(
    join(mocksDir, "default.mock.https"),
    `>>>\nANY //\n\n!!!\nreplay()\n`,
  );

  recordingsDir = join(workspace, "recordings");
  await mkdir(recordingsDir, { recursive: true });

  await initializePardon({ cwd: workspace }, [undici]);
});

after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

it("records a forwarded exchange between start and finish", async () => {
  const upstream = await startUpstream();
  const proxy = await proxyFor("vcr", upstream.origin);
  try {
    assert.equal((await control(proxy, "POST", "trip")).status, 200);

    const forwarded = await fetch(
      `http://127.0.0.1:${proxy.port}/proxy:svc/thing`,
    );
    assert.equal(forwarded.status, 200);
    assert.equal(upstream.hits, 1, "record forwards to the real upstream");

    assert.equal((await control(proxy, "PUT", "trip")).status, 200);

    const log = await readFile(join(recordingsDir, "trip.log.https"), "utf-8");
    assert.match(log, /\/thing/, "the exchange was written to the log");
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

it("replays that exchange and finishes clean when fully consumed", async () => {
  // upstream is down for replay — the exchange must come from the log recorded
  // by the previous test (same recordings dir).
  const proxy = await proxyFor("replay", "http://127.0.0.1:1"); // unreachable
  try {
    assert.equal((await control(proxy, "POST", "trip")).status, 200);

    const served = await fetch(
      `http://127.0.0.1:${proxy.port}/proxy:svc/thing`,
    );
    assert.equal(
      served.status,
      200,
      "served from the recorded log, not upstream",
    );

    const finish = await control(proxy, "PUT", "trip");
    assert.equal(finish.status, 200, "log fully consumed");
  } finally {
    await proxy.close();
  }
});

it("fails finish with 422 when the recorded log is not fully replayed", async () => {
  // write a log with one exchange that the (silent) service never requests.
  const recorder = createHttpsLogRecorder(
    join(recordingsDir, "lonely.log.https"),
  );
  await recorder.append({
    key: "GET https://svc.example/never",
    request: {
      method: "GET",
      origin: "https://svc.example",
      pathname: "/never",
      headers: new Headers(),
    },
    response: {
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: "",
    },
  });

  const proxy = await proxyFor("replay", "http://127.0.0.1:1");
  try {
    assert.equal((await control(proxy, "POST", "lonely")).status, 200);

    // no data-plane traffic — the recorded exchange goes unconsumed.
    const finish = await control(proxy, "PUT", "lonely");
    assert.equal(finish.status, 422);
    const body = (await finish.json()) as { status: string; error: string };
    assert.equal(body.status, "error");
    assert.match(body.error, /never replayed|fewer downstream calls/);
    // the un-replayed exchange is named with its method + URL.
    assert.match(body.error, /GET https:\/\/svc\.example\/never/);
  } finally {
    await proxy.close();
  }
});

it("enforces one open recording at a time and matching finish", async () => {
  const upstream = await startUpstream();
  const proxy = await proxyFor("vcr", upstream.origin);
  try {
    assert.equal((await control(proxy, "POST", "a")).status, 200);

    // a second start while one is open is rejected.
    assert.equal((await control(proxy, "POST", "b")).status, 409);

    // finishing a slug other than the open one is rejected.
    assert.equal((await control(proxy, "PUT", "b")).status, 409);

    // finishing the open one succeeds, and re-finishing has nothing open.
    assert.equal((await control(proxy, "PUT", "a")).status, 200);
    assert.equal((await control(proxy, "PUT", "a")).status, 409);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

it("rejects an empty recording name", async () => {
  const upstream = await startUpstream();
  const proxy = await proxyFor("vcr", upstream.origin);
  try {
    const empty = await fetch(
      `http://127.0.0.1:${proxy.port}/runner/recording/`,
      { method: "POST" },
    );
    assert.equal(empty.status, 400);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

it("accepts a hierarchical (slashed) test name as a nested recording", async () => {
  // pardon test names can contain `/`; the name maps to a nested log path.
  const upstream = await startUpstream();
  const proxy = await proxyFor("vcr", upstream.origin);
  try {
    assert.equal(
      (await control(proxy, "POST", "suite/case/lifecycle")).status,
      200,
    );
    await fetch(`http://127.0.0.1:${proxy.port}/proxy:svc/thing`);
    assert.equal(
      (await control(proxy, "PUT", "suite/case/lifecycle")).status,
      200,
      "finish matches the same hierarchical name",
    );

    const log = await readFile(
      join(recordingsDir, "suite", "case", "lifecycle.log.https"),
      "utf-8",
    );
    assert.match(log, /\/thing/);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

it("derives a safe, traversal-free recording path from a test name", () => {
  // a normalizing HTTP client already collapses `..` path segments before they
  // reach the server, but recordingSlug is the last-line guard for any caller:
  // slashes are preserved as nesting, each segment is sanitized, and empty /
  // `.` / `..` segments are dropped so the log can never escape <recordings>.
  assert.equal(recordingSlug("suite/case/lifecycle"), "suite/case/lifecycle");
  assert.equal(
    recordingSlug("todos › create [env=local]"),
    "todos-create-env-local",
  );
  assert.equal(recordingSlug("x/../../y"), "x/y");
  assert.equal(recordingSlug("/a//b/"), "a/b");
  assert.equal(recordingSlug("../.."), "recording");
});

it("auto mode records a missing log, then replays it once present", async () => {
  const upstream = await startUpstream();
  try {
    // first run: the log is absent → auto records (forwarding to the upstream).
    {
      const proxy = await proxyFor("vcr", upstream.origin);
      try {
        const start = await control(proxy, "POST", "auto-trip");
        assert.equal(start.status, 200);
        assert.equal(
          ((await start.json()) as { mode: string }).mode,
          "vcr",
          "a missing log resolves to record",
        );
        await fetch(`http://127.0.0.1:${proxy.port}/proxy:svc/thing`);
        assert.equal(upstream.hits, 1);
        assert.equal((await control(proxy, "PUT", "auto-trip")).status, 200);
      } finally {
        await proxy.close();
      }
    }

    // second run: the log now exists → auto replays (upstream unreachable, and
    // must not be touched).
    {
      const proxy = await proxyFor("vcr", "http://127.0.0.1:1");
      try {
        const start = await control(proxy, "POST", "auto-trip");
        assert.equal(start.status, 200);
        assert.equal(
          ((await start.json()) as { mode: string }).mode,
          "replay",
          "an existing log resolves to replay",
        );
        const served = await fetch(
          `http://127.0.0.1:${proxy.port}/proxy:svc/thing`,
        );
        assert.equal(served.status, 200, "served from the recorded log");
        assert.equal(upstream.hits, 1, "replay never touches the upstream");
        assert.equal((await control(proxy, "PUT", "auto-trip")).status, 200);
      } finally {
        await proxy.close();
      }
    }
  } finally {
    await upstream.close();
  }
});

it("strict replay refuses to start when the log is absent (the CI guard)", async () => {
  // `--mode replay` never records: a missing log is an error at start, not a
  // silent recording (the `npm ci` vs `npm install` distinction).
  const proxy = await proxyFor("replay", "http://127.0.0.1:1");
  try {
    const start = await control(proxy, "POST", "never-recorded");
    assert.equal(start.status, 422);
    const body = (await start.json()) as { status: string; error: string };
    assert.equal(body.status, "error");
    assert.match(body.error, /not found/);
  } finally {
    await proxy.close();
  }
});

it("rejects a recording lifecycle in a mode that has none", async () => {
  const upstream = await startUpstream();
  const proxy = await proxyFor("passthrough", upstream.origin);
  try {
    const started = await control(proxy, "POST", "x");
    assert.equal(started.status, 409);
    assert.equal(upstream.hits, 0, "control traffic is never forwarded");
  } finally {
    await proxy.close();
    await upstream.close();
  }
});
