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
 * Handle a control-plane request. Today only `/runner/health` exists (the
 * TestContainers readiness probe); plan/run/traces endpoints grow in here.
 */
export async function handleControlRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const target = req.url ?? "/";
  const q = target.indexOf("?");
  const pathname = q === -1 ? target : target.slice(0, q);

  if (req.method === "GET" && pathname === "/runner/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end(`proxy: unknown control endpoint ${pathname}\n`);
}
