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

import { PardonError } from "../error.js";
import { createFromHttpHeaders } from "../request/header-object.js";
import { intoSearchParams } from "../request/search-object.js";
import type { FetchObject, ResponseObject } from "../request/fetch-object.js";
import {
  forwardRequest,
  hopByHopHeaders,
  rewriteForUpstream,
  type ProxyConfig,
} from "./forwarder.js";
import { handleControlRequest, isControlPath } from "./control.js";
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
  /** out-of-band capture of each proxied exchange (redaction/persistence). */
  capture?: CaptureHook;
};

/** A running proxy listener handle. */
export type ProxyServer = {
  port: number;
  server: Server;
  close(): Promise<void>;
};

/**
 * Bind a single reverse-proxy listener. `/proxy:<name>/...` requests are
 * forwarded to the matching upstream; everything else is a client error. When
 * no port is configured an unused one is auto-picked and published at
 * `environment.proxy.port`.
 */
export async function startProxyServer(
  config: ProxyConfig,
  options: ProxyServerOptions = {},
): Promise<ProxyServer> {
  const server = createServer((req, res) => {
    void handleRequest(config, options, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port ?? 0, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  environment.proxy = { ...environment.proxy, port };

  return {
    port,
    server,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function handleRequest(
  config: ProxyConfig,
  options: ProxyServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const target = req.url ?? "/";
  const q = target.indexOf("?");
  const pathname = q === -1 ? target : target.slice(0, q);

  // control plane (`/runner/…`) is dispatched before the forwarder ever sees
  // the request, so it is never proxied or captured.
  if (isControlPath(pathname)) {
    await handleControlRequest(req, res);
    return;
  }

  try {
    const inbound = await intoFetchObject(req);
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
