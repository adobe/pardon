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
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The control-plane prefix. Because every data-plane path is `/proxy:<name>/…`,
 * the bare `/runner/…` segment is reserved for runner actions and can never
 * collide with a `proxy:`-namespaced upstream (even one named `runner`). The
 * proxy never forwards or captures control-plane traffic — it is routed away
 * before the forwarder sees it.
 */
export function isControlPath(pathname: string): boolean {
  return pathname === "/runner" || pathname.startsWith("/runner/");
}

/**
 * Outcome of a control-plane action. `ok` maps to 200; otherwise `status` is the
 * HTTP status and `error` the message the external driver reports (e.g. a replay
 * completeness failure it turns into a test assertion).
 */
export type ControlResult =
  | { ok: true; body?: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * Control-plane hooks the server wires into request handling. Lets a
 * remote/containerized proxy be driven by an external test framework the same
 * way the in-process runner drives it directly: one recording open at a time,
 * started by name and finished (record: flushed; replay: completeness-checked).
 */
export type ControlPlane = {
  /** Bind the record/replay upstreams to the recording `name` and open it. */
  startRecording(name: string): ControlResult;
  /**
   * Finish the recording `name` (must be the open one): record flushes its grace
   * window; replay requires the log to have been fully consumed, surfacing a
   * completeness failure as a non-ok result the driver can assert on.
   */
  finishRecording(name: string): Promise<ControlResult>;
};

const RECORDING_PREFIX = "/runner/recording/";

/**
 * Handle a control-plane request:
 *  - `GET  /runner/health`            — readiness (Testcontainers wait strategy)
 *  - `POST /runner/recording/{slug}`  — start recording `{slug}`
 *  - `PUT  /runner/recording/{slug}`  — finish recording `{slug}`
 *
 * The `{slug}` names the per-testcase log (`<recordings>/{slug}.log.https`); an
 * external driver passes a distinct slug per (possibly parameterized) test.
 */
export async function handleControlRequest(
  req: IncomingMessage,
  res: ServerResponse,
  control: ControlPlane,
): Promise<void> {
  const { pathname } = new URL(`req:${req.url ?? "/"}`);

  if (req.method === "GET" && pathname === "/runner/health") {
    return send(res, { ok: true, body: { status: "ok" } });
  }

  if (
    (req.method === "POST" || req.method === "PUT") &&
    pathname.startsWith(RECORDING_PREFIX)
  ) {
    const slug = decodeURIComponent(pathname.slice(RECORDING_PREFIX.length));

    // a single path segment: no empty slug, no nested path.
    if (!slug || slug.includes("/")) {
      return send(res, {
        ok: false,
        status: 400,
        error: `proxy: expected /runner/recording/{slug}, got ${pathname}`,
      });
    }

    // drain any request body so the socket is reusable (body is unused).
    for await (const _ of req) {
      void _;
    }

    return send(
      res,
      req.method === "POST"
        ? control.startRecording(slug)
        : await control.finishRecording(slug),
    );
  }

  return send(res, {
    ok: false,
    status: 404,
    error: `proxy: unknown control endpoint ${req.method} ${pathname}`,
  });
}

function send(res: ServerResponse, result: ControlResult): void {
  if (result.ok) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", ...result.body }));
    return;
  }

  res.writeHead(result.status, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: "error", error: result.error }));
}
