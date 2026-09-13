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

/** Control-plane hooks the server wires into request handling. */
export type ControlPlane = {
  /**
   * Point the record/replay upstreams at the recording for a testcase (see
   * `ProxyServer.useRecording`). Lets a remote/containerized proxy be told which
   * recording to serve, the same way the in-process runner calls it directly.
   */
  useRecording(name: string): void;
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Handle a control-plane request: `/runner/health` (TestContainers readiness)
 * and `POST /runner/recording` (select the current recording by testcase name);
 * plan/run/traces endpoints grow in here.
 */
export async function handleControlRequest(
  req: IncomingMessage,
  res: ServerResponse,
  control: ControlPlane,
): Promise<void> {
  const { pathname } = new URL(`req:${req.url ?? "/"}`);

  if (req.method === "GET" && pathname === "/runner/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method === "POST" && pathname === "/runner/recording") {
    let name: unknown;
    try {
      ({ name } = JSON.parse((await readBody(req)) || "{}"));
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end(`proxy: /runner/recording expects a JSON body { name }\n`);
      return;
    }

    if (typeof name !== "string" || !name) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end(`proxy: /runner/recording requires a non-empty "name"\n`);
      return;
    }

    control.useRecording(name);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", recording: name }));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end(`proxy: unknown control endpoint ${pathname}\n`);
}
