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
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { PardonError } from "../error.js";
import { createFromHttpHeaders } from "../request/header-object.js";
import { intoSearchParams } from "../request/search-object.js";
import type { FetchObject, ResponseObject } from "../request/fetch-object.js";
import {
  createMockStore,
  forwardRequest,
  hopByHopHeaders,
  loadMocks,
  parseProxyPath,
  rewriteForUpstream,
  serveMock,
  type MockUpstream,
  type ProxyConfig,
  type ProxyMode,
} from "./forwarder.js";
import { handleControlRequest, isControlPath } from "./control.js";
import { createHttpsLogRecorder, recordingSlug } from "./record.js";
import { loadRecordings } from "./replay.js";
import { pardonRuntime } from "../../runtime/runtime-deferred.js";
import { HTTP } from "../formats/http-fmt.js";

/**
 * Read a Node inbound request into a pardon FetchObject, faithfully — the raw
 * request target is split into pathname + search, headers are carried across
 * verbatim, and the body is buffered as-is. No rewriting happens here.
 */
export async function intoFetchObject(
  req: IncomingMessage,
): Promise<FetchObject> {
  const target = req.url ?? "/";
  const q = target.indexOf("?");
  const pathname = q === -1 ? target : target.slice(0, q);
  const search = q === -1 ? "" : target.slice(q);

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks);

  return {
    method: req.method,
    pathname,
    searchParams: intoSearchParams(search),
    headers: createFromHttpHeaders(req.headers),
    body: raw.length ? raw.toString() : undefined,
  };
}

/**
 * Write a pardon ResponseObject back to a Node response, dropping hop-by-hop
 * headers (fetch already decoded the body, so content-encoding/length no longer
 * describe the bytes we are about to write).
 */
export function writeResponseObject(
  res: ServerResponse,
  response: ResponseObject,
): void {
  const headers: [string, string][] = [];
  response.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      headers.push([key, value]);
    }
  });

  res.writeHead(Number(response.status), response.statusText, headers);
  res.end(response.rawBody ?? response.body ?? "");
}

/**
 * Capture the forwarded exchange out-of-band. Receives the rewritten request
 * actually sent upstream and the upstream response. Runs after the client has
 * been served (failures here must not affect the proxied response).
 */
export type CaptureHook = (
  request: FetchObject,
  response: ResponseObject,
) => void | Promise<void>;

export type ProxyServerOptions = {
  cwd?: string;
  /** out-of-band capture of each proxied exchange (redaction/persistence). */
  capture?: CaptureHook;
};

/**
 * A per-testcase recording binding, returned by `useRecording` and owned by the
 * test that started it (not the server) — so distinct tests can hold distinct
 * sessions without interfering, in support of replaying several at once.
 */
export type RecordingSession = {
  /**
   * Finalize this test's recording after its function has returned and its flows
   * have settled. Waits the configured `grace` period so async work in the
   * backend can issue its remaining downstream calls; in `replay` mode it then
   * requires this session's log to have been fully consumed (a leftover exchange
   * means the service made fewer calls than were recorded).
   */
  finish(): Promise<void>;
};

/** A running proxy listener handle. */
export type ProxyServer = {
  port: number;
  server: Server;
  /**
   * Point the record/replay upstreams at the recording for `name` (a testcase),
   * chosen automatically as `<recordings>/<slug>.log.https`. In `record` mode
   * this opens (and truncates) a fresh log to append to; in `replay` mode it
   * loads that log and resets its cursor. Returns a session the caller finishes
   * once the test is done. A no-op session in `mock`/forward modes.
   */
  useRecording(name: string): RecordingSession;
  close(): Promise<void>;
};

/**
 * Bind a single reverse-proxy listener. `/proxy:<name>/...` requests are
 * forwarded to the matching upstream; everything else is a client error. When
 * no port is configured an unused one is auto-picked and published at
 * `environment.proxy.port`.
 */
export async function startProxyServer(
  mode: ProxyMode,
  config: ProxyConfig,
  options: ProxyServerOptions = {},
): Promise<ProxyServer> {
  // load `.mock.https` suites once at startup; each mock-backed upstream keeps a
  // single ephemeral session `store` for the life of this process. Record/replay
  // binding is deferred: the durable log is chosen per testcase when the runner
  // calls `useRecording` (see below), not fixed at startup.
  const cwd = options.cwd ?? process.cwd();

  if ((mode === "record" || mode === "replay") && !config.recordings) {
    throw new PardonError(
      `proxy: mode:${mode} requires a recordings directory`,
    );
  }

  const mockUpstreams = new Map<string, MockUpstream>();
  for (const [name, upstream] of Object.entries(config.upstreams)) {
    if (
      mode === "mock" ||
      mode === "record" ||
      mode == "replay" ||
      upstream.mocks
    ) {
      if (!upstream.mocks) {
        throw new PardonError(
          `proxy: upstream ${name} is mode:${mode} but has no mocks path`,
        );
      }

      mockUpstreams.set(name, {
        mocks: loadMocks(upstream.mocks, options.cwd),
        store: createMockStore(),
      });
    }
  }

  // Bind every record/replay upstream to the single log for testcase `name`
  // (`<recordings>/<slug>.log.https`). One log per testcase (not per upstream):
  // a single recorder/replay cursor is shared across upstreams so the log keeps
  // the global order the service issued its downstream calls in. Only `origin`
  // stays per-upstream (the forward target). Called before each test so a single
  // long-lived proxy serves a whole suite, one recording at a time.
  const grace = config.grace ?? 0;
  const noopSession: RecordingSession = { async finish() {} };

  const useRecording = (name: string): RecordingSession => {
    if (mode !== "record" && mode !== "replay") {
      return noopSession;
    }

    const log = join(
      resolve(cwd, config.recordings!),
      `${recordingSlug(name)}.log.https`,
    );

    const recorder =
      mode === "record" ? createHttpsLogRecorder(log) : undefined;
    const replaySource =
      mode === "replay" ? loadRecordings(log, cwd) : undefined;

    for (const [upstreamName, upstream] of Object.entries(config.upstreams)) {
      const mock = mockUpstreams.get(upstreamName);
      if (!mock) {
        continue;
      }

      mock.record = recorder
        ? { origin: upstream.origin, recorder }
        : undefined;
      mock.replaySource = replaySource;
    }

    // the session owns this test's log, so completeness is checked against the
    // recording this very test bound — not whatever the server last saw.
    return {
      async finish() {
        if (mode === "record") {
          // let the backend issue any late downstream calls (still captured by
          // the recorder above) before the next test rebinds it.
          if (grace > 0) {
            await delay(grace);
          }
          return;
        }

        // replay: wait (up to grace) for the service to consume the whole log,
        // then require it — a leftover means fewer calls were made than recorded.
        const deadline = Date.now() + grace;
        while (replaySource!.remaining() > 0 && Date.now() < deadline) {
          await delay(Math.min(25, deadline - Date.now()));
        }

        const remaining = replaySource!.remaining();
        if (remaining > 0) {
          throw new PardonError(
            `replay: ${remaining} recorded exchange(s) for ${name} were never ` +
              `replayed — the service made fewer downstream calls than recorded`,
          );
        }
      },
    };
  };

  const server = createServer((req, res) => {
    void handleRequest(config, options, mockUpstreams, useRecording, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port ?? 0, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  environment["proxy-port"] = port;
  environment["proxy-origin"] = `http://localhost:${port}`;

  return {
    port,
    server,
    useRecording,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function handleRequest(
  config: ProxyConfig,
  options: ProxyServerOptions,
  mockUpstreams: Map<string, MockUpstream>,
  useRecording: (name: string) => void,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { pathname } = new URL(`req:${req.url ?? "/"}`);

  // control plane (`/runner/…`) is dispatched before the forwarder ever sees
  // the request, so it is never proxied or captured.
  if (isControlPath(pathname)) {
    await handleControlRequest(req, res, { useRecording });
    return;
  }

  try {
    const inbound = await intoFetchObject(req);

    // mock-backed upstream: serve synthetically from the `.mock.https` suite
    // instead of forwarding. Nothing is captured (the exchange is invented).
    const route = parseProxyPath(inbound.pathname);
    if (route && mockUpstreams.has(route.name)) {
      const headers = new Headers(inbound.headers);
      for (const h of hopByHopHeaders) {
        headers.delete(h);
      }
      const mockRequest = { ...inbound, pathname: route.pathname, headers };

      const runtime = await pardonRuntime();
      const response = await serveMock(
        mockRequest,
        mockUpstreams.get(route.name)!,
        runtime,
      );
      writeResponseObject(res, response);

      console.log(`
---
>>> (mock:${route.name})
${HTTP.stringify(mockRequest)}

<<<
${HTTP.responseObject.stringify(response)}`);
      return;
    }

    const { request } = rewriteForUpstream(inbound, config.upstreams);
    const response = await forwardRequest(request);
    writeResponseObject(res, response);

    console.log(`
---
>>>
${HTTP.stringify(request)}

<<<
${HTTP.responseObject.stringify(response)}`);

    // capture is out-of-band: the client has been served, so a redaction or
    // persistence failure must not surface as a proxy error.
    if (options.capture) {
      try {
        await options.capture(request, response);
      } catch (captureError) {
        console.warn("proxy: capture failed", captureError);
      }
    }
  } catch (error) {
    // PardonError => client misrouted (bad prefix / unknown upstream);
    // anything else => upstream/forwarding failure.
    const status = error instanceof PardonError ? 404 : 502;
    res.writeHead(status, { "content-type": "text/plain" });
    res.end(`${(error as Error)?.message ?? "proxy error"}\n`);
  }
}
